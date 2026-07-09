import { updateScrollProgress } from '../app/utils.js';
import { COMMUNITY_CATEGORIES } from './constants.js';
import { state } from './state.js';
import { $, $$ } from './utils.js';
import { renderCategoryRail, renderEmptyState, renderGrid, renderResultBar } from './render.js';

let openDetail = null;
let openSubmit = null;

export function initCommunityUI(handlers = {}) {
  openDetail = handlers.openDetail || null;
  openSubmit = handlers.openSubmit || null;

  bindSearch();
  bindNsfw();
  bindTheme();
  bindFocusSearch();
  bindScrollProgress();
  renderCategoryRail(selectCategory);
  updateNSFWButton();
}

export function applyCommunityFilters({ scrollTop = false } = {}) {
  let list = [...state.entries];
  const query = state.query.trim().toLowerCase();

  if (query) {
    const terms = query.split(/\s+/).filter(Boolean);
    list = list.filter(entry => {
      const haystack = [
        entry.title,
        entry.prompt,
        entry.negative,
        entry.comment,
        entry.submitter,
        ...(entry.tags || []),
        ...(entry.category || []),
      ].join('\n').toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }

  if (state.activeCategory) {
    list = list.filter(entry => entry.category?.[0] === state.activeCategory);
  }

  if (!state.showNSFW) list = list.filter(entry => !entry.nsfw);

  state.filtered = list;
  renderCategoryRail(selectCategory);
  renderResultBar();
  renderGrid(state.filtered, { onOpenDetail: openDetail });
  renderEmptyState({
    onSubmit: () => openSubmit?.(),
    onClearSearch: clearSearch,
    onShowAll: showAll,
    onShowNSFW: () => {
      state.showNSFW = true;
      localStorage.setItem('strings-nsfw', 'true');
      updateNSFWButton();
      applyCommunityFilters({ scrollTop: true });
    },
  });

  if (scrollTop) {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function selectCategory(category) {
  state.activeCategory = COMMUNITY_CATEGORIES.includes(category) ? category : null;
  applyCommunityFilters({ scrollTop: true });
}

function clearSearch() {
  state.query = '';
  const input = $('#search');
  if (input) input.value = '';
  applyCommunityFilters({ scrollTop: true });
}

function showAll() {
  state.activeCategory = null;
  state.query = '';
  const input = $('#search');
  if (input) input.value = '';
  applyCommunityFilters({ scrollTop: true });
}

function bindFocusSearch() {
  $$('[data-focus-search]').forEach(button => {
    button.addEventListener('click', () => $('#search')?.focus());
  });
}

function bindSearch() {
  const input = $('#search');
  const clear = $('#searchClear');
  if (!input) return;

  let timer = 0;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      state.query = input.value;
      if (clear) clear.hidden = !input.value;
      applyCommunityFilters({ scrollTop: true });
    }, 140);
  });
  clear?.addEventListener('click', clearSearch);
}

function bindNsfw() {
  $('#nsfwBtn')?.addEventListener('click', () => {
    state.showNSFW = !state.showNSFW;
    localStorage.setItem('strings-nsfw', String(state.showNSFW));
    updateNSFWButton();
    applyCommunityFilters({ scrollTop: true });
  });
}

function updateNSFWButton() {
  const btn = $('#nsfwBtn');
  if (!btn) return;
  btn.classList.toggle('active', state.showNSFW);
  btn.setAttribute('aria-pressed', String(state.showNSFW));
  const total = state.entries.filter(entry => entry.nsfw).length;
  btn.title = state.showNSFW ? `NSFW 混显中 · ${total} 条` : `NSFW 已隐藏 · ${total} 条`;
}

function bindTheme() {
  $('#themeBtn')?.addEventListener('click', () => {
    const dark = !document.body.classList.contains('dark');
    document.body.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    localStorage.setItem('fadian-dark', dark ? '1' : '0');
  });
}

function bindScrollProgress() {
  updateScrollProgress();
  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  window.addEventListener('resize', updateScrollProgress, { passive: true });
}

export function syncAfterLoad() {
  updateNSFWButton();
  applyCommunityFilters();
}
