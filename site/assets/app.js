import { state, RECENT_STORAGE_KEY, LAST_BROWSE_STORAGE_KEY, NSFW_STORAGE_KEY, R18G_STORAGE_KEY, DENSITY_STORAGE_KEY } from './app/state.js?v=20260707-cache21';
import { $, esc, safeJsonParse, updateSearchClear, prefersReducedMotion } from './app/utils.js?v=20260707-cache21';
import { setLoading, showSkeleton, hideSkeleton } from './app/feedback.js?v=20260707-cache21';
import { isCodexLocked, firstUnlockedCodex, showNsfwLockedHint, isEntryAccessBlocked, isR18gPath } from './app/access.js?v=20260707-cache21';
import { loadMedia, loadAbout, fetchCodex, findCodexMeta, notifyCodexDataStatus, buildTreeFromEntries } from './app/data.js?v=20260707-cache21';
import { parseSearchQuery, matchSearchPlan } from './app/search.js?v=20260707-cache21';
import { hasEntryImage, primeResourceHints } from './app/media.js?v=20260707-cache21';
import { isFav, setFavoritesActions, toggleFav } from './app/favorites.js?v=20260707-cache21';
import { buildFavoritesCodex, FAVORITES_CODEX_ID } from './app/fav-codex.js?v=20260707-cache21';
import { renderList, clearMasonry, updateVirtualCards, setMasonryActions } from './app/masonry.js?v=20260707-cache21';
import { openLightbox } from './app/lightbox.js?v=20260707-cache21';
import { copyEntry } from './app/copy.js?v=20260707-cache21';
import { openReportDialog } from './app/report.js?v=20260707-cache21';
import { readUrlState, syncUrlState, openEntryDeepLink, setRouterActions } from './app/router.js?v=20260707-cache21';
import { setupCodexPicker, setupAbout, setupTreeSpy, updateCodexPickerState, renderTree, renderCodexHeader, renderCategoryRail, updateRailActive, updateResultBar, updateEmptyState, setCodexUiActions } from './app/codex-ui.js?v=20260707-cache21';
import { normalizeRecentEntries, normalizeLastBrowse, scheduleBrowseStateSave, suppressBrowseStateSave, setHistoryActions } from './app/history.js?v=20260707-cache21';
import { bindUI, applyDensity, setUiActions } from './app/ui.js?v=20260707-cache21';
import { maybeShowOnboarding } from './app/onboarding.js?v=20260707-cache21';

let codexLoadSeq = 0;
const codexPickerTitle = c => c?.selectorTitle || c?.title || '';
const setOnlyFavControl = checked => {
  state.onlyFav = Boolean(checked);
  const onlyFav = $('#onlyFav');
  if (onlyFav) onlyFav.checked = state.onlyFav;
};

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
    setupTreeSpy();
    bindUI();
    state.pendingUrlState = readUrlState();
    const wantsFavorites = state.pendingUrlState.favorites || state.pendingUrlState.codex === FAVORITES_CODEX_ID;
    const initialMeta = findCodexMeta(state.pendingUrlState.codex);
    const initialId = initialMeta && !isCodexLocked(initialMeta)
      ? initialMeta.id
      : firstUnlockedCodex()?.id || codexes[0]?.id;
    if (initialMeta && isCodexLocked(initialMeta)) showNsfwLockedHint();
    if (codexes.length) {
      hideSkeleton(initSkeletonToken);
      await loadCodex(initialId, { urlState: wantsFavorites ? null : state.pendingUrlState, replaceUrl: true, saveBrowse: false });
      if (wantsFavorites) {
        await openFavoritesView({ urlState: state.pendingUrlState, replaceUrl: true, saveBrowse: false });
      }
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
  if (id === FAVORITES_CODEX_ID) return openFavoritesView(options);
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
      state.favoritesView = false;
      state.browseCodex = codex;
      setOnlyFavControl(false);
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

export async function openFavoritesView(options = {}) {
  const baseCodex = state.codex && !state.favoritesView
    ? state.codex
    : state.browseCodex;
  if (baseCodex) state.browseCodex = baseCodex;
  else {
    const fallback = firstUnlockedCodex();
    if (fallback) {
      await loadCodex(fallback.id, { replaceUrl: true, saveBrowse: false });
    }
  }

  const seq = ++codexLoadSeq;
  showSkeleton(seq);
  setLoading('');
  clearMasonry();
  try {
    const codex = await buildFavoritesCodex();
    if (seq !== codexLoadSeq) return;
    const wasSwitching = Boolean(state.codex);
    const render = () => {
      if (seq !== codexLoadSeq) return;
      primeResourceHints({ codexes: [codex] });
      state.favoritesView = true;
      setOnlyFavControl(true);
      state.codex = codex;
      const c = state.codex;
      const baseMeta = findCodexMeta(state.browseCodex?.id);
      const codexSelect = $('#codexSelect');
      if (codexSelect && state.browseCodex) codexSelect.value = state.browseCodex.id;
      $('#codexTitle').textContent = c.title;
      $('#codexMeta').textContent = `${c.version} · ${c.entryCount} 条`;
      const codexBtnText = $('#codexBtnText');
      if (codexBtnText) codexBtnText.textContent = codexPickerTitle(baseMeta || state.browseCodex) || '选择法典';
      updateCodexPickerState();
      const urlState = options.urlState && (options.urlState.favorites || options.urlState.codex === FAVORITES_CODEX_ID)
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
    if (wasSwitching && !prefersReducedMotion() && typeof document.startViewTransition === 'function') {
      await new Promise(r => setTimeout(r, 170));
      if (seq !== codexLoadSeq) return;
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
  if (state.favoritesView) list = list.filter(isFav);   // 收藏视图里取消收藏即时消卡
  list = list.filter(e => !isEntryAccessBlocked(e));  // NSFW/R18G 条目级访问控制
  state.list = list;
  updateResultBar();
  renderList(options);
}

/* 收藏视图内取消收藏后：从仍被收藏的词条重算合成法典的条目/计数/目录树，刷新顶栏、横幅进度、
   分类轨道与目录树。applyFilter 只重过滤 state.list，不动这些在 buildFavoritesCodex 时烤进合成
   法典的字段，故单独在此就地更新（不重放 chipIn 入场、不重绘横幅封面，保持“取消即消卡”的顺滑）。 */
function refreshFavoritesView(options = {}) {
  if (!state.favoritesView || !state.codex) { applyFilter(options); return; }
  const c = state.codex;
  c.entries = c.entries.filter(isFav);
  c.entryCount = c.entries.length;
  c.imagedCount = c.entries.filter(hasEntryImage).length;
  c.tree = buildTreeFromEntries(c.entries);
  state.activePath = normalizeRoutePath(c.tree, state.activePath);   // 清空的来源分组从路径里剔除
  const meta = $('#codexMeta');
  if (meta) meta.textContent = `${c.version} · ${c.entryCount} 条`;
  const pct = c.entryCount ? Math.round((c.imagedCount / c.entryCount) * 100) : 0;
  const bpFill = document.querySelector('#codexBanner .bp-fill');
  const bpText = document.querySelector('#codexBanner .bp-text');
  if (bpFill) bpFill.style.width = `${pct}%`;
  if (bpText) bpText.textContent = `${c.imagedCount} / ${c.entryCount} 已配图`;
  renderTree();
  renderCategoryRail({ animate: false });
  applyFilter(options);
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
  openFavoritesView,
  openEntryDeepLink,
  renderTree,
  applyFilter,
  updateVirtualCards,
});

setFavoritesActions({ applyFilter, refreshFavoritesView });

setMasonryActions({
  openLightbox,
  copyEntry,
  toggleFav,
  reportEntry: (entry, opts = {}) => openReportDialog({ entry, ...opts }),
});

setUiActions({ loadCodex, openFavoritesView, applyFilter });

init();
