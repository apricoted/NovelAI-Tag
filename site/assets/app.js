import { state, RECENT_STORAGE_KEY, LAST_BROWSE_STORAGE_KEY, NSFW_STORAGE_KEY, R18G_STORAGE_KEY, DENSITY_STORAGE_KEY } from './app/state.js?v=20260702-cache14';
import { $, esc, safeJsonParse, updateSearchClear, prefersReducedMotion } from './app/utils.js?v=20260702-cache14';
import { setLoading, showSkeleton, hideSkeleton } from './app/feedback.js?v=20260702-cache14';
import { isCodexLocked, firstUnlockedCodex, showNsfwLockedHint, isEntryAccessBlocked, isR18gPath } from './app/access.js?v=20260702-cache14';
import { loadMedia, loadAbout, fetchCodex, findCodexMeta, notifyCodexDataStatus } from './app/data.js?v=20260702-cache14';
import { parseSearchQuery, matchSearchPlan } from './app/search.js?v=20260702-cache14';
import { hasEntryImage, primeResourceHints } from './app/media.js?v=20260702-cache14';
import { isFav, setFavoritesActions, toggleFav } from './app/favorites.js?v=20260702-cache14';
import { renderList, clearMasonry, updateVirtualCards, setMasonryActions } from './app/masonry.js?v=20260702-cache14';
import { openLightbox } from './app/lightbox.js?v=20260702-cache14';
import { copyEntry } from './app/copy.js?v=20260702-cache14';
import { openReportDialog } from './app/report.js?v=20260702-cache14';
import { readUrlState, syncUrlState, openEntryDeepLink, setRouterActions } from './app/router.js?v=20260702-cache14';
import { setupCodexPicker, setupAbout, updateCodexPickerState, renderTree, renderCodexHeader, updateRailActive, updateResultBar, updateEmptyState, setCodexUiActions } from './app/codex-ui.js?v=20260702-cache14';
import { normalizeRecentEntries, normalizeLastBrowse, scheduleBrowseStateSave, suppressBrowseStateSave, setHistoryActions } from './app/history.js?v=20260702-cache14';
import { bindUI, applyDensity, setUiActions } from './app/ui.js?v=20260702-cache14';
import { maybeShowOnboarding } from './app/onboarding.js?v=20260702-cache14';

let codexLoadSeq = 0;
const codexPickerTitle = c => c?.selectorTitle || c?.title || '';

export async function init() {
  const initSkeletonToken = 'init';
  try {
    showSkeleton(initSkeletonToken, { delay: 0 });
    setLoading('');
    const savedFavs = safeJsonParse(localStorage.getItem('fadian-favs'), []);
    state.favs = new Set(Array.isArray(savedFavs) ? savedFavs : []);
    state.recentEntries = normalizeRecentEntries(safeJsonParse(localStorage.getItem(RECENT_STORAGE_KEY), []));
    state.lastBrowse = normalizeLastBrowse(safeJsonParse(localStorage.getItem(LAST_BROWSE_STORAGE_KEY), null));
    state.allowNsfw = localStorage.getItem(NSFW_STORAGE_KEY) === '1';
    document.body.classList.toggle('nsfw-unlocked', state.allowNsfw);
    state.allowR18g = state.allowNsfw && localStorage.getItem(R18G_STORAGE_KEY) === '1';
    document.body.classList.toggle('r18g-unlocked', state.allowR18g);
    applyDensity(localStorage.getItem(DENSITY_STORAGE_KEY), { render: false });
    const [codexes, media, about] = await Promise.all([
      fetch('data/codexes.json', { cache: 'no-store' }).then(r => r.json()),
      loadMedia(),
      loadAbout(),
    ]);
    state.codexes = codexes;
    state.media = { ...state.media, ...media };
    state.about = about;
    primeResourceHints({ media: state.media, codexes: state.codexes });
    const sel = $('#codexSelect');
    sel.innerHTML = codexes.map(c => `<option value="${c.id}">${esc(codexPickerTitle(c))}</option>`).join('');
    sel.onchange = () => loadCodex(sel.value);
    setupCodexPicker();
    setupAbout();
    bindUI();
    state.pendingUrlState = readUrlState();
    const initialMeta = findCodexMeta(state.pendingUrlState.codex);
    const initialId = initialMeta && !isCodexLocked(initialMeta)
      ? initialMeta.id
      : firstUnlockedCodex()?.id || codexes[0]?.id;
    if (initialMeta && isCodexLocked(initialMeta)) showNsfwLockedHint();
    if (codexes.length) {
      hideSkeleton(initSkeletonToken);
      await loadCodex(initialId, { urlState: state.pendingUrlState, replaceUrl: true, saveBrowse: false });
      maybeShowOnboarding();
    } else {
      hideSkeleton(initSkeletonToken);
      setLoading('还没有可显示的法典数据');
    }
  } catch (ex) {
    console.error(ex);
    hideSkeleton(initSkeletonToken);
    setLoading('加载失败，请刷新页面重试');
  }
}

export async function loadCodex(id, options = {}) {
  const meta = findCodexMeta(id) || { id };
  if (isCodexLocked(meta)) {
    showNsfwLockedHint();
    const fallback = firstUnlockedCodex();
    if (fallback && fallback.id !== meta.id) {
      return loadCodex(fallback.id, { ...options, urlState: null, replaceUrl: true });
    }
    setLoading('需要在设置中开启 NSFW 法典展示后才能查看');
    return;
  }
  const seq = ++codexLoadSeq;
  showSkeleton(seq);
  setLoading('');
  clearMasonry();
  try {
    const codex = await fetchCodex(meta);
    if (seq !== codexLoadSeq) return;
    const wasSwitching = Boolean(state.codex);
    const render = () => {
      if (seq !== codexLoadSeq) return;
      primeResourceHints({ codexes: [codex] });
      state.codex = codex;
      const c = state.codex;
      const codexSelect = $('#codexSelect');
      if (codexSelect) codexSelect.value = c.id;
      $('#codexTitle').textContent = c.title;
      $('#codexMeta').textContent = `${c.author ? c.author + ' · ' : ''}${c.version} · ${c.entryCount} 条`;
      const codexBtnText = $('#codexBtnText');
      if (codexBtnText) codexBtnText.textContent = codexPickerTitle(findCodexMeta(c.id)) || c.title;
      updateCodexPickerState();
      const urlState = options.urlState && (!options.urlState.codex || options.urlState.codex === c.id || (c.aliases || []).includes(options.urlState.codex))
        ? options.urlState
        : null;
      const nextPath = normalizeRoutePath(c.tree, urlState?.path || []);
      state.activePath = !state.allowR18g && isR18gPath(nextPath) ? [] : nextPath;
      state.query = urlState?.q || '';
      state.seenAnimated.clear();
      state.recentRandomIds = [];
      $('#search').value = state.query;
      updateSearchClear();
      renderTree();
      renderCodexHeader();
      if (options.saveBrowse === false) suppressBrowseStateSave(2000);
      applyFilter({ resetScroll: true });
      syncUrlState({ replace: options.replaceUrl !== false, entry: urlState?.entry || '', saveBrowse: options.saveBrowse !== false });
      if (urlState?.entry) {
        window.setTimeout(() => openEntryDeepLink(urlState.entry), 180);
      }
      setLoading('');
      notifyCodexDataStatus(c);
    };
    /* 换法典用同文档 View Transition 做整页交叉淡化（数据已就绪，回调内纯同步渲染，不冻结页面）；
       首次进站没有旧画面、减少动效、老浏览器 → 直接渲染 */
    if (wasSwitching && !prefersReducedMotion() && typeof document.startViewTransition === 'function') {
      /* 先等选择菜单/面板退场（~180ms）再开始变形——切换动效别被浮层挡住白播一场 */
      await new Promise(r => setTimeout(r, 170));
      if (seq !== codexLoadSeq) return;
      /* vt-codex 只存活于本次过渡：横幅独立变形等换法典专属动画全挂它名下 */
      const h = document.documentElement;
      h.classList.add('vt-codex');
      const vt = document.startViewTransition(render);
      vt.finished.catch(() => {}).finally(() => h.classList.remove('vt-codex'));
      await vt.updateCallbackDone;
    } else {
      render();
    }
  } catch (ex) {
    if (seq === codexLoadSeq) {
      console.error(ex);
      setLoading('加载失败，请刷新页面重试');
    }
  } finally {
    hideSkeleton(seq);
  }
}

export function applyFilter(options = {}) {
  const plan = parseSearchQuery(state.query);
  state.searchPlan = plan;
  let list = state.codex.entries;
  if (plan.raw) {
    list = list.filter(e => matchSearchPlan(e, plan));
  } else if (state.activePath.length) {
    const p = state.activePath;
    list = list.filter(e => p.every((seg, i) => e.path[i] === seg));
  }
  if (state.onlyImaged) list = list.filter(hasEntryImage);
  if (state.onlyFav) list = list.filter(isFav);
  list = list.filter(e => !isEntryAccessBlocked(e));  // NSFW/R18G 条目级访问控制
  state.list = list;
  updateResultBar();
  renderList(options);
}

function normalizeRoutePath(tree, path) {
  if (!Array.isArray(path) || !path.length) return [];
  let nodes = Array.isArray(tree) ? tree : [];
  const normalized = [];
  for (const seg of path) {
    const node = nodes.find(nd => nd?.name === seg);
    if (!node) return [];
    normalized.push(node.name);
    nodes = Array.isArray(node.children) ? node.children : [];
  }
  return normalized;
}

setRouterActions({
  onUrlSync: scheduleBrowseStateSave,
  renderTree,
  applyFilter,
  openLightbox,
  updateVirtualCards,
});

setCodexUiActions({
  loadCodex,
  applyFilter,
  syncUrlState,
  openLightbox,
  updateVirtualCards,
});

setHistoryActions({
  loadCodex,
  openEntryDeepLink,
  renderTree,
  applyFilter,
  updateVirtualCards,
});

setFavoritesActions({ applyFilter });

setMasonryActions({
  openLightbox,
  copyEntry,
  toggleFav,
  reportEntry: (entry, opts = {}) => openReportDialog({ entry, ...opts }),
});

setUiActions({ loadCodex, applyFilter });

init();
