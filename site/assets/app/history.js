import { state, RECENT_ENTRY_LIMIT, RECENT_STORAGE_KEY, LAST_BROWSE_STORAGE_KEY } from './state.js';
import { $, esc, updateSearchClear, updateScrollProgress } from './utils.js';
import { hasEntryImage, thumbUrl } from './media.js';
import { syncUrlState } from './router.js';
import { isCodexLocked, showNsfwLockedHint } from './access.js';
import { toast } from './feedback.js';

const historyActions = {
  loadCodex: async () => {},
  openEntryDeepLink: () => {},
  renderTree: () => {},
  applyFilter: () => {},
  updateVirtualCards: () => {},
};

export function setHistoryActions(actions = {}) {
  Object.assign(historyActions, actions);
}

export function normalizeRecentEntries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && item.codexId && item.entryId && item.title)
    .map(item => ({
      codexId: String(item.codexId),
      codexTitle: String(item.codexTitle || item.codexId),
      entryId: String(item.entryId),
      title: String(item.title),
      path: Array.isArray(item.path) ? item.path.map(String) : [],
      thumb: String(item.thumb || ''),
      at: Number(item.at) || Date.now(),
    }))
    .slice(0, RECENT_ENTRY_LIMIT);
}

export function normalizeLastBrowse(value) {
  if (!value || typeof value !== 'object' || !value.codexId) return null;
  return {
    codexId: String(value.codexId),
    codexTitle: String(value.codexTitle || value.codexId),
    path: Array.isArray(value.path) ? value.path.map(String) : [],
    q: String(value.q || ''),
    onlyImaged: Boolean(value.onlyImaged),
    onlyFav: Boolean(value.onlyFav),
    entryId: String(value.entryId || ''),
    scrollY: Math.max(0, Number(value.scrollY) || 0),
    at: Number(value.at) || Date.now(),
  };
}

/* ---------------- 浏览记录 ---------------- */
export function saveRecentEntries() {
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(state.recentEntries));
}

export function recordRecentEntry(e) {
  if (!state.codex || !e) return;
  const key = `${state.codex.id}:${e.id}`;
  const item = {
    codexId: state.codex.id,
    codexTitle: state.codex.title,
    entryId: e.id,
    title: e.title,
    path: e.path || [],
    thumb: hasEntryImage(e) ? thumbUrl(e) : '',
    at: Date.now(),
  };
  state.recentEntries = [
    item,
    ...state.recentEntries.filter(old => `${old.codexId}:${old.entryId}` !== key),
  ].slice(0, RECENT_ENTRY_LIMIT);
  saveRecentEntries();
}

let browseSaveTimer = 0;
export function currentBrowseSnapshot(entryId = state.lightbox.entry?.id || '') {
  if (!state.codex) return null;
  return {
    codexId: state.codex.id,
    codexTitle: state.codex.title,
    path: state.activePath || [],
    q: state.query.trim(),
    onlyImaged: Boolean(state.onlyImaged),
    onlyFav: Boolean(state.onlyFav),
    entryId,
    scrollY: Math.max(0, Math.round(window.scrollY || 0)),
    at: Date.now(),
  };
}

export function saveBrowseStateNow(entryId) {
  const snapshot = currentBrowseSnapshot(entryId);
  if (!snapshot) return;
  state.lastBrowse = snapshot;
  localStorage.setItem(LAST_BROWSE_STORAGE_KEY, JSON.stringify(snapshot));
}

export function scheduleBrowseStateSave(entryId) {
  clearTimeout(browseSaveTimer);
  browseSaveTimer = window.setTimeout(() => saveBrowseStateNow(entryId), 180);
}

export function browseDesc(snapshot) {
  if (!snapshot) return '暂无可恢复的位置';
  if (snapshot.q) return `${snapshot.codexTitle} · 搜索 “${snapshot.q}”`;
  if (snapshot.path?.length) return `${snapshot.codexTitle} · ${snapshot.path.join(' › ')}`;
  return `${snapshot.codexTitle} · ${formatRecentTime(snapshot.at)}`;
}

export function formatRecentTime(ts) {
  const diff = Math.max(0, Date.now() - Number(ts || 0));
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(Number(ts)).toLocaleDateString('zh-CN');
}

export function renderHistoryPanel() {
  const resume = $('#resumeBrowse');
  const resumeDesc = $('#resumeDesc');
  if (resumeDesc) resumeDesc.textContent = browseDesc(state.lastBrowse);
  if (resume) resume.disabled = !state.lastBrowse;
  const clearBtn = $('#clearRecent');
  if (clearBtn) clearBtn.disabled = state.recentEntries.length === 0;

  const list = $('#recentList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.recentEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = '最近还没有打开过词条。点卡片放大图或复制词条后，这里会自动记录。';
    list.appendChild(empty);
    return;
  }
  for (const item of state.recentEntries) {
    const btn = document.createElement('button');
    btn.className = 'recent-item';
    btn.type = 'button';
    btn.dataset.codex = item.codexId;
    btn.dataset.entry = item.entryId;

    if (item.thumb) {
      const img = document.createElement('img');
      img.className = 'recent-thumb';
      img.src = item.thumb;
      img.alt = '';
      btn.appendChild(img);
    } else {
      const mark = document.createElement('span');
      mark.className = 'recent-thumb no-img';
      mark.textContent = '☆';
      btn.appendChild(mark);
    }

    const main = document.createElement('span');
    main.className = 'recent-main';
    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = item.title;
    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    meta.textContent = `${item.codexTitle}${item.path?.length ? ' · ' + item.path.join(' › ') : ''}`;
    main.append(title, meta);
    btn.appendChild(main);

    const time = document.createElement('span');
    time.className = 'recent-time';
    time.textContent = formatRecentTime(item.at);
    btn.appendChild(time);
    btn.onclick = () => document.dispatchEvent(new CustomEvent('openRecentEntry', { detail: item }));
    list.appendChild(btn);
  }
}

export function applyBrowseControls(snapshot) {
  state.onlyImaged = Boolean(snapshot.onlyImaged);
  state.onlyFav = Boolean(snapshot.onlyFav);
  const onlyImaged = $('#onlyImaged');
  const onlyFav = $('#onlyFav');
  if (onlyImaged) onlyImaged.checked = state.onlyImaged;
  if (onlyFav) onlyFav.checked = state.onlyFav;
}

export function applyBrowseState(snapshot) {
  state.activePath = snapshot.path || [];
  state.query = snapshot.q || '';
  const search = $('#search');
  if (search) search.value = state.query;
  updateSearchClear();
  historyActions.renderTree();
  historyActions.applyFilter({ resetScroll: true });
  syncUrlState({ replace: true, entry: snapshot.entryId || '', saveBrowse: false });
}

export async function resumeLastBrowse() {
  const snapshot = state.lastBrowse;
  if (!snapshot) return;
  const meta = state.codexes.find(c => c.id === snapshot.codexId);
  if (meta && isCodexLocked(meta)) {
    showNsfwLockedHint();
    return;
  }
  applyBrowseControls(snapshot);
  if (!state.codex || state.codex.id !== snapshot.codexId) {
    await historyActions.loadCodex(snapshot.codexId, {
      urlState: { codex: snapshot.codexId, path: snapshot.path || [], q: snapshot.q || '', entry: snapshot.entryId || '' },
      replaceUrl: true,
      saveBrowse: false,
    });
  } else {
    applyBrowseState(snapshot);
    if (snapshot.entryId) window.setTimeout(() => historyActions.openEntryDeepLink(snapshot.entryId), 120);
  }
  if (!snapshot.entryId) {
    window.setTimeout(() => {
      window.scrollTo({ top: snapshot.scrollY || 0, left: 0, behavior: 'auto' });
      historyActions.updateVirtualCards(true);
      updateScrollProgress();
    }, 120);
  }
  toast('已恢复上次浏览位置');
}

export async function openRecentEntry(item) {
  if (!item?.codexId || !item.entryId) return;
  const meta = state.codexes.find(c => c.id === item.codexId);
  if (meta && isCodexLocked(meta)) {
    showNsfwLockedHint();
    return;
  }
  const urlState = { codex: item.codexId, path: item.path || [], q: '', entry: item.entryId };
  if (!state.codex || state.codex.id !== item.codexId) {
    state.onlyFav = false;
    state.onlyImaged = false;
    applyBrowseControls({ onlyFav: false, onlyImaged: false });
    await historyActions.loadCodex(item.codexId, { urlState, replaceUrl: true });
  } else {
    state.query = '';
    state.activePath = item.path || [];
    state.onlyFav = false;
    state.onlyImaged = false;
    applyBrowseControls({ onlyFav: false, onlyImaged: false });
    const search = $('#search');
    if (search) search.value = '';
    updateSearchClear();
    historyActions.renderTree();
    historyActions.applyFilter({ resetScroll: true });
    syncUrlState({ replace: true, entry: item.entryId });
    window.setTimeout(() => historyActions.openEntryDeepLink(item.entryId), 120);
  }
}
