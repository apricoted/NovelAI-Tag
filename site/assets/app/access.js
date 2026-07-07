import { state, NSFW_LOCKED_MESSAGE, R18G_LOCKED_MESSAGE } from './state.js?v=20260707-cache21';
import { toast } from './feedback.js?v=20260707-cache21';

export function isNsfwCodex(c) {
  return Boolean(c?.nsfw);
}

export function entryRating(e) {
  return String(e?.rating || e?.level || '').toLowerCase();
}

export function isNsfwRating(rating) {
  return ['restricted', 'r18', 'r18g', 'nsfw'].includes(String(rating || '').toLowerCase());
}

export function isNsfwPathSegment(name) {
  return String(name || '').toLowerCase() === 'nsfw';
}

export function isEntryNsfw(e) {
  return isNsfwRating(entryRating(e));
}

export function isCodexLocked(c) {
  return isNsfwCodex(c) && !state.allowNsfw;
}

export function firstUnlockedCodex() {
  return state.codexes.find(c => !isCodexLocked(c));
}

export function showNsfwLockedHint() {
  toast(NSFW_LOCKED_MESSAGE, '!');
}

/* R18G / 重口：作者已把这类内容单独归入顶级分类「r18g/重口」，按分类名识别 */
export function isR18gName(name) {
  const s = String(name || '').toLowerCase();
  return s.includes('r18g') || s.includes('重口');
}

export function isR18gEntry(e) {
  const p = e?.path;
  return entryRating(e) === 'r18g' || (Array.isArray(p) && p.some(isR18gName));
}

export function isR18gPath(path) {
  return Array.isArray(path) && path.some(isR18gName);
}

export function isR18gBlocked(e) {
  return isR18gEntry(e) && !state.allowR18g;
}

export function isEntryAccessBlocked(e) {
  if (isR18gBlocked(e)) return true;
  return isEntryNsfw(e) && !state.allowNsfw;
}

export function r18gRevealKey(e) {
  return `${state.codex?.id || ''}:${e?.id || ''}`;
}

export function isR18gRevealed(e) {
  return state.r18gRevealed.has(r18gRevealKey(e));
}

export function needsR18gReveal(e) {
  return isR18gEntry(e) && state.allowR18g && !isR18gRevealed(e);
}

export function revealR18gEntry(e) {
  state.r18gRevealed.add(r18gRevealKey(e));
}

export function showR18gLockedHint() {
  toast(R18G_LOCKED_MESSAGE, '!');
}
