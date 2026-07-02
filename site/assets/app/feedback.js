import { $ } from './utils.js?v=20260702-cache13';

export function setLoading(text) {
  const el = $('#loading');
  if (!el) return;
  const message = String(text || '');
  const visibleMessage = message.startsWith('正在加载') ? '' : message;
  el.textContent = visibleMessage;
  el.hidden = !visibleMessage;
  $('#main')?.classList.toggle('is-loading', Boolean(visibleMessage));
}

let skeletonToken = null;
let skeletonDelayTimer = 0;
let skeletonHideTimer = 0;
let skeletonShownAt = 0;
let skeletonMinVisible = 300;

function timeNow() {
  return window.performance?.now ? window.performance.now() : Date.now();
}

function setSkeletonPending(pending) {
  $('#main')?.classList.toggle('has-skeleton', pending);
}

function setSkeletonVisible(visible) {
  const grid = $('#skeletonGrid');
  const main = $('#main');
  if (grid) grid.hidden = !visible;
  main?.classList.toggle('skeleton-visible', visible);
}

export function showSkeleton(token, { delay = 200, minVisible = 300 } = {}) {
  const grid = $('#skeletonGrid');
  if (!grid) return;
  skeletonToken = token;
  skeletonMinVisible = minVisible;
  setSkeletonPending(true);
  clearTimeout(skeletonDelayTimer);
  clearTimeout(skeletonHideTimer);
  skeletonHideTimer = 0;

  if (!grid.hidden) {
    skeletonShownAt = timeNow();
    setSkeletonVisible(true);
    return;
  }

  if (delay <= 0) {
    skeletonShownAt = timeNow();
    setSkeletonVisible(true);
    return;
  }

  skeletonDelayTimer = window.setTimeout(() => {
    if (skeletonToken !== token) return;
    skeletonDelayTimer = 0;
    skeletonShownAt = timeNow();
    setSkeletonVisible(true);
  }, delay);
}

export function hideSkeleton(token) {
  if (skeletonToken !== token) return;
  const grid = $('#skeletonGrid');
  clearTimeout(skeletonDelayTimer);
  skeletonDelayTimer = 0;

  if (!grid || grid.hidden) {
    skeletonToken = null;
    setSkeletonPending(false);
    setSkeletonVisible(false);
    return;
  }

  const wait = Math.max(0, skeletonMinVisible - (timeNow() - skeletonShownAt));
  clearTimeout(skeletonHideTimer);
  skeletonHideTimer = window.setTimeout(() => {
    if (skeletonToken !== token) return;
    skeletonHideTimer = 0;
    skeletonToken = null;
    setSkeletonPending(false);
    setSkeletonVisible(false);
  }, wait);
}

let toastTimer;
export function toast(msg, icon = '✓') {
  const t = $('#toast');
  t.textContent = icon ? `${icon} ${msg}` : msg;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}
