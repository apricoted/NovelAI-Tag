import { state } from './state.js?v=20260707-cache20';
import { toast } from './feedback.js?v=20260707-cache20';
import { findCodexMeta } from './data.js?v=20260707-cache20';

const favoriteActions = { applyFilter: () => {} };

export function setFavoritesActions(actions = {}) {
  Object.assign(favoriteActions, actions);
}

/* 收藏键始终挂在词条的真实法典下；全部收藏视图里的词条带 _srcCodexId 标记，
   照它回溯正主；普通浏览时词条就属于当前法典。 */
function ownerCodex(e) {
  return (e?._srcCodexId && findCodexMeta(e._srcCodexId)) || state.codex;
}

export function favKeys(e, codex = ownerCodex(e)) {
  const keys = [`${codex.id}:${e.id}`];
  for (const alias of codex.aliases || []) {
    const aliasEntryId = e.id.startsWith(`${codex.id}-`)
      ? `${alias}${e.id.slice(codex.id.length)}`
      : e.id;
    keys.push(`${alias}:${aliasEntryId}`);
  }
  return keys;
}

export function favKey(e) { return favKeys(e)[0]; }
export function isFav(e) { return favKeys(e).some(key => state.favs.has(key)); }

export function saveFavs() {
  localStorage.setItem('fadian-favs', JSON.stringify([...state.favs]));
}

export function toggleFav(e, btn) {
  const keys = favKeys(e);
  const k = keys[0];
  if (isFav(e)) keys.forEach(key => state.favs.delete(key));
  else state.favs.add(k);
  saveFavs();
  const on = state.favs.has(k);
  if (btn) {
    btn.textContent = on ? '★' : '☆';
    btn.classList.toggle('on', on);
    btn.title = on ? '取消收藏' : '收藏';
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
  }
  if (state.favoritesView) favoriteActions.applyFilter({ transition: 'filter' });   // 收藏视图里取消收藏，卡片就地消失
  toast(on ? `已收藏：${e.title}` : `已取消收藏：${e.title}`);
}
