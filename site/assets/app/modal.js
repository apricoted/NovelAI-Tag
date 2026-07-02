import { prefersReducedMotion } from './utils.js?v=20260702-cache5';

const maskTimers = new WeakMap();
const maskOpeners = new WeakMap();

export function focusableIn(root) {
  if (!root) return [];
  return [...root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

export function focusFirstIn(root) {
  requestAnimationFrame(() => focusableIn(root)[0]?.focus());
}

export function trapFocus(ev, root) {
  if (ev.key !== 'Tab') return;
  const list = focusableIn(root);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

export function openMask(mask, trigger = document.activeElement) {
  if (!mask) return;
  clearTimeout(maskTimers.get(mask));
  if (trigger instanceof HTMLElement) maskOpeners.set(mask, trigger);
  mask.hidden = false;
  void mask.offsetWidth;
  mask.classList.add('show');
  focusFirstIn(mask);
}

export function closeMask(mask) {
  if (!mask) return;
  mask.classList.remove('show');
  const restoreFocus = () => {
    const opener = maskOpeners.get(mask);
    if (opener?.isConnected) opener.focus();
  };
  if (prefersReducedMotion()) {
    mask.hidden = true;
    restoreFocus();
    return;
  }
  maskTimers.set(mask, setTimeout(() => {
    if (!mask.classList.contains('show')) {
      mask.hidden = true;
      restoreFocus();
    }
  }, 240));
}

export function isMaskOpen(mask) {
  return Boolean(mask && !mask.hidden);
}
