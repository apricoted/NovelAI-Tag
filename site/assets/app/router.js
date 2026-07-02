import { state } from './state.js?v=20260702-cache13';
import { $ } from './utils.js?v=20260702-cache13';
import { hasEntryImage } from './media.js?v=20260702-cache13';
import { toast } from './feedback.js?v=20260702-cache13';
import { isEntryAccessBlocked, isR18gBlocked, showNsfwLockedHint, showR18gLockedHint } from './access.js?v=20260702-cache13';

const routerActions = {
  onUrlSync: () => {},
  renderTree: () => {},
  applyFilter: () => {},
  openLightbox: () => {},
  updateVirtualCards: () => {},
};

export function setRouterActions(actions = {}) {
  Object.assign(routerActions, actions);
}

export function readUrlState() {
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  const pathValues = params.getAll('path');
  const path = pathValues.length > 1
    ? pathValues.map(seg => seg.trim()).filter(Boolean)
    : decodeLegacyPathParam(pathValues[0] || '');
  return {
    codex: params.get('codex') || '',
    path,
    q: params.get('q') || '',
    entry: params.get('entry') || hash.get('entry') || '',
  };
}

export function syncUrlState({ replace = true, entry, saveBrowse = true } = {}) {
  if (state.suppressUrlSync || !state.codex) return;
  const params = new URLSearchParams();
  params.set('codex', state.codex.id);
  const q = state.query.trim();
  if (q) params.set('q', q);
  else if (state.activePath.length) {
    for (const seg of state.activePath) params.append('path', seg);
  }
  const entryId = entry === undefined ? (state.lightbox.entry?.id || '') : entry;
  if (entryId) params.set('entry', entryId);
  const next = `${location.pathname}?${params.toString()}`;
  if (next === location.pathname + location.search && !location.hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', next);
  if (saveBrowse) routerActions.onUrlSync(entryId);
}

function decodeLegacyPathParam(value) {
  return String(value || '')
    .split('/')
    .map(seg => {
      try {
        return decodeURIComponent(seg).trim();
      } catch {
        return String(seg || '').trim();
      }
    })
    .filter(Boolean);
}

export function openEntryDeepLink(entryId) {
  if (!state.codex || !entryId) return;
  const candidates = [entryId];
  for (const alias of state.codex.aliases || []) {
    if (entryId.startsWith(`${alias}-`)) {
      candidates.push(`${state.codex.id}${entryId.slice(alias.length)}`);
    }
  }
  const entry = state.codex.entries.find(e => candidates.includes(e.id));
  if (!entry) return;
  if (isR18gBlocked(entry)) {
    showR18gLockedHint();
    syncUrlState({ entry: '' });
    return;
  }
  if (isEntryAccessBlocked(entry)) {
    showNsfwLockedHint();
    syncUrlState({ entry: '' });
    return;
  }
  if (!state.query && !state.activePath.length && entry.path?.length) {
    state.activePath = entry.path;
    routerActions.renderTree();
    routerActions.applyFilter({ resetScroll: true });
  }
  const index = state.list.findIndex(e => e.id === entry.id);
  const placement = index >= 0 ? state.placements[index] : null;
  if (placement) {
    const top = Math.max(0, placement.top + $('#masonry').getBoundingClientRect().top + window.scrollY - 120);
    window.scrollTo({ top, left: 0, behavior: 'auto' });
    routerActions.updateVirtualCards(true);
  }
  if (hasEntryImage(entry)) {
    const node = index >= 0 ? state.nodes.get(index) : null;
    const img = node?.querySelector('.card-img');
    routerActions.openLightbox(entry, 0, img || null);
  } else {
    toast('这个词条还没有例图');
    syncUrlState({ entry: '' });
  }
}
