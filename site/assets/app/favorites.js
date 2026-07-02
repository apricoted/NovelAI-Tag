import { state } from './state.js?v=20260702-cache17';
import { toast } from './feedback.js?v=20260702-cache17';

const favoriteActions = { applyFilter: () => {} };

export function setFavoritesActions(actions = {}) {
  Object.assign(favoriteActions, actions);
}

export function favKeys(e) {
  const keys = [`${state.codex.id}:${e.id}`];
  for (const alias of state.codex.aliases || []) {
    const aliasEntryId = e.id.startsWith(`${state.codex.id}-`)
      ? `${alias}${e.id.slice(state.codex.id.length)}`
      : e.id;
    keys.push(`${alias}:${aliasEntryId}`);
  }
  return keys;
}

export function favKey(e) { return favKeys(e)[0]; }
export function isFav(e) { return favKeys(e).some(key => state.favs.has(key)); }

export function toggleFav(e, btn) {
  const keys = favKeys(e);
  const k = keys[0];
  if (isFav(e)) keys.forEach(key => state.favs.delete(key));
  else state.favs.add(k);
  localStorage.setItem('fadian-favs', JSON.stringify([...state.favs]));
  const on = state.favs.has(k);
  if (btn) {
    btn.textContent = on ? '★' : '☆';
    btn.classList.toggle('on', on);
    btn.title = on ? '取消收藏' : '收藏';
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
  }
  if (state.onlyFav) favoriteActions.applyFilter({ resetScroll: true, transition: 'filter' });
  toast(on ? `已收藏：${e.title}` : `已取消收藏：${e.title}`);
}
