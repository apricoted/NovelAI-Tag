import { $ } from './utils.js';

export function setLoading(text) {
  const el = $('#loading');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  $('#main')?.classList.toggle('is-loading', Boolean(text));
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
