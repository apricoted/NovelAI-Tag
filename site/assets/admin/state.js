export const KEY = 'strings-admin-token';

export const COMMUNITY_CATEGORIES = ['随手分享', '画风', '人物', '服装', '动作', '构图', '场景'];
export const COMMUNITY_STATUSES = ['pending', 'approved', 'hidden', 'rejected', 'deleted'];

export const STATUS_LABELS = {
  pending: '待审',
  approved: '已发布',
  hidden: '已下架',
  rejected: '已拒绝',
  deleted: '已删除',
};

export const FEEDBACK_LABELS = {
  pending: '待处理',
  resolved: '已处理',
  ignored: '已忽略',
};

export const BATCH_ACTIONS_BY_STATUS = {
  pending: ['approve', 'reject', 'moveCategory', 'delete'],
  approved: ['unpublish', 'moveCategory', 'delete'],
  hidden: ['publish', 'moveCategory', 'delete'],
  rejected: ['publish', 'moveCategory', 'delete'],
  deleted: ['restore', 'publish', 'purge'],
};

export const state = {
  view: 'dashboard',
  status: 'pending',
  feedbackStatus: 'pending',
  query: '',
  category: '',
  nsfw: '',
  items: [],
  feedbackItems: [],
  stats: null,
  selectedId: '',
  selectedFeedbackId: '',
  selectedIds: new Set(),
  lastSelectedId: '',
  batchFailures: [],
  batchRetry: null,
  dirty: false,
  dirtyId: '',
  busy: false,
  loading: false,
};

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

export function escAttr(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function formatDate(value, withTime = true) {
  const n = Number(value || 0);
  if (!n) return '无时间';
  try {
    return new Date(n).toLocaleString('zh-CN', withTime ? undefined : { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return '无时间';
  }
}

export function currentItems() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter(item => {
    if (state.category && (item.category || [])[0] !== state.category) return false;
    if (state.nsfw === 'sfw' && item.nsfw) return false;
    if (state.nsfw === 'nsfw' && !item.nsfw) return false;
    if (!q) return true;
    const haystack = [
      item.title, item.prompt, item.negative, item.comment, item.submitter,
      (item.tags || []).join(' '), (item.category || []).join(' '),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

export function selectedItem() {
  return state.items.find(item => item.id === state.selectedId) || null;
}

export function selectedFeedback() {
  return state.feedbackItems.find(item => item.id === state.selectedFeedbackId) || null;
}

export function currentFeedbackItems() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.feedbackItems;
  return state.feedbackItems.filter(item => {
    const context = item.context || {};
    const entry = context.entry || {};
    const codex = context.codex || {};
    const page = context.page || {};
    return [
      item.type, item.typeLabel, item.description, item.contact,
      entry.id, entry.title, codex.id, codex.title, page.url,
    ].join(' ').toLowerCase().includes(q);
  });
}

export function selectionCounts(items = currentItems()) {
  const visibleIds = new Set(items.map(item => item.id));
  let visible = 0;
  for (const id of state.selectedIds) {
    if (visibleIds.has(id)) visible += 1;
  }
  return {
    visible,
    hidden: Math.max(0, state.selectedIds.size - visible),
    total: state.selectedIds.size,
  };
}

export function isBatchActionAllowed(status, action) {
  return (BATCH_ACTIONS_BY_STATUS[status] || []).includes(action);
}

export function pluralCount(value) {
  if (value == null || value === '') return '0';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : String(value);
}
