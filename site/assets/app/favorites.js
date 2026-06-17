import { state } from './state.js';
import { toast } from './feedback.js';

const favoriteActions = { applyFilter: () => {} };

export function setFavoritesActions(actions = {}) {
  Object.assign(favoriteActions, actions);
}

export function favKey(e) { return state.codex.id + ':' + e.id; }
export function toggleFav(e, btn) {
  const k = favKey(e);
  if (state.favs.has(k)) state.favs.delete(k); else state.favs.add(k);
  localStorage.setItem('fadian-favs', JSON.stringify([...state.favs]));
  const on = state.favs.has(k);
  if (btn) {
    btn.textContent = on ? '★' : '☆';
    btn.classList.toggle('on', on);
    btn.title = on ? '取消收藏' : '收藏';
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
  }
  if (state.onlyFav) favoriteActions.applyFilter({ resetScroll: true });
  toast(on ? `已收藏：${e.title}` : `已取消收藏：${e.title}`);
}
