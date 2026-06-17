import { state } from './state.js';
import { $ } from './utils.js';
import { hasEntryImage } from './media.js';
import { toast } from './feedback.js';

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
  const path = (params.get('path') || '')
    .split('/')
    .map(seg => seg.trim())
    .filter(Boolean);
  return {
    codex: params.get('codex') || '',
    path,
    q: params.get('q') || '',
    entry: params.get('entry') || hash.get('entry') || '',
  };
}

export function syncUrlState({ replace = true, entry } = {}) {
  if (state.suppressUrlSync || !state.codex) return;
  const params = new URLSearchParams();
  params.set('codex', state.codex.id);
  const q = state.query.trim();
  if (q) params.set('q', q);
  else if (state.activePath.length) params.set('path', state.activePath.join('/'));
  const entryId = entry === undefined ? (state.lightbox.entry?.id || '') : entry;
  if (entryId) params.set('entry', entryId);
  routerActions.onUrlSync(entryId);
  const next = `${location.pathname}?${params.toString()}`;
  if (next === location.pathname + location.search && !location.hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', next);
}

export function openEntryDeepLink(entryId) {
  if (!state.codex || !entryId) return;
  const entry = state.codex.entries.find(e => e.id === entryId);
  if (!entry) return;
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
