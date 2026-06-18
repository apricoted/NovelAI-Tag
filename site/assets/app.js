import { state, RECENT_STORAGE_KEY, LAST_BROWSE_STORAGE_KEY, NSFW_STORAGE_KEY, DENSITY_STORAGE_KEY } from './app/state.js';
import { $, esc, safeJsonParse, updateSearchClear } from './app/utils.js';
import { setLoading, showSkeleton, hideSkeleton } from './app/feedback.js';
import { isCodexLocked, firstUnlockedCodex, showNsfwLockedHint } from './app/access.js';
import { loadMedia, loadAbout, fetchCodex, notifyCodexDataStatus } from './app/data.js';
import { parseSearchQuery, matchSearchPlan } from './app/search.js';
import { hasEntryImage, primeResourceHints } from './app/media.js';
import { favKey, setFavoritesActions, toggleFav } from './app/favorites.js';
import { renderList, clearMasonry, updateVirtualCards, setMasonryActions } from './app/masonry.js';
import { openLightbox } from './app/lightbox.js';
import { copyEntry } from './app/copy.js';
import { readUrlState, syncUrlState, openEntryDeepLink, setRouterActions } from './app/router.js';
import { setupCodexPicker, setupAbout, updateCodexPickerState, renderTree, renderCodexHeader, updateRailActive, updateResultBar, updateEmptyState, setCodexUiActions } from './app/codex-ui.js';
import { normalizeRecentEntries, normalizeLastBrowse, scheduleBrowseStateSave, suppressBrowseStateSave, setHistoryActions } from './app/history.js';
import { bindUI, applyDensity, setUiActions } from './app/ui.js';

let codexLoadSeq = 0;

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
    sel.innerHTML = codexes.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('');
    sel.onchange = () => loadCodex(sel.value);
    setupCodexPicker();
    setupAbout();
    bindUI();
    state.pendingUrlState = readUrlState();
    const initialMeta = state.codexes.find(c => c.id === state.pendingUrlState.codex);
    const initialId = initialMeta && !isCodexLocked(initialMeta)
      ? state.pendingUrlState.codex
      : firstUnlockedCodex()?.id || codexes[0]?.id;
    if (initialMeta && isCodexLocked(initialMeta)) showNsfwLockedHint();
    if (codexes.length) {
      hideSkeleton(initSkeletonToken);
      await loadCodex(initialId, { urlState: state.pendingUrlState, replaceUrl: true, saveBrowse: false });
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
  const meta = state.codexes.find(c => c.id === id) || { id };
  if (isCodexLocked(meta)) {
    showNsfwLockedHint();
    const fallback = firstUnlockedCodex();
    if (fallback && fallback.id !== id) {
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
    primeResourceHints({ codexes: [codex] });
    state.codex = codex;
    const c = state.codex;
    const codexSelect = $('#codexSelect');
    if (codexSelect) codexSelect.value = c.id;
    $('#codexTitle').textContent = c.title;
    $('#codexMeta').textContent = `${c.author ? c.author + ' · ' : ''}${c.version} · ${c.entryCount} 条`;
    const codexBtnText = $('#codexBtnText');
    if (codexBtnText) codexBtnText.textContent = c.title;
    updateCodexPickerState();
    const urlState = options.urlState && (!options.urlState.codex || options.urlState.codex === c.id)
      ? options.urlState
      : null;
    state.activePath = urlState?.path?.length ? urlState.path : [];
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
  if (state.onlyFav) list = list.filter(e => state.favs.has(favKey(e)));
  state.list = list;
  updateResultBar();
  renderList(options);
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

setMasonryActions({ openLightbox, copyEntry, toggleFav });

setUiActions({ loadCodex, applyFilter });

init();
