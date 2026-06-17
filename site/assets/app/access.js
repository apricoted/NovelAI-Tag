import { state, NSFW_LOCKED_MESSAGE } from './state.js';
import { toast } from './feedback.js';

export function isNsfwCodex(c) {
  return Boolean(c?.nsfw);
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

