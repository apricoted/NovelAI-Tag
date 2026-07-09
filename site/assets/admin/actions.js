import {
  $, $$, state, STATUS_LABELS, FEEDBACK_LABELS, currentItems, selectedItem, selectedFeedback,
} from './state.js';
import {
  token, setToken, clearToken, getCommunity, getStats, mutateCommunity,
  getFeedback, decideFeedback, deleteFeedback,
} from './api.js';
import { renderAll, renderHeader, renderToolbar, renderList, renderDetail } from './render.js';
import { collectCommunityEdits } from './editor.js';

let toastTimer;

export function initActions() {
  syncTheme();
  bindTopbar();
  bindNavigation();
  bindDelegates();
  if (token()) enter();
  else showLogin();
}

async function enter() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#reloadBtn').hidden = false;
  $('#logoutBtn').hidden = false;
  await loadCurrent();
}

function showLogin(message = '') {
  $('#app').hidden = true;
  $('#reloadBtn').hidden = true;
  $('#logoutBtn').hidden = true;
  $('#login').hidden = false;
  $('#loginErr').textContent = message;
}

function bindTopbar() {
  $('#loginBtn').addEventListener('click', () => {
    const value = $('#tokenInput').value.trim();
    if (!value) return;
    setToken(value);
    enter();
  });
  $('#tokenInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') $('#loginBtn').click();
  });
  $('#logoutBtn').addEventListener('click', () => {
    clearToken();
    showLogin();
  });
  $('#reloadBtn').addEventListener('click', () => loadCurrent());
  $('#themeBtn').addEventListener('click', () => {
    const dark = !document.body.classList.contains('dark');
    document.body.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('strings-dark', dark ? 'true' : 'false');
  });
  $('#globalSearch').addEventListener('input', event => {
    state.query = event.target.value || '';
    renderHeader();
    renderList();
    renderDetail();
  });
}

function bindNavigation() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view || 'dashboard';
      if (state.view === 'review') state.status = 'pending';
      if (state.view === 'content' && state.status === 'pending') state.status = 'approved';
      state.selectedIds.clear();
      loadCurrent();
    });
  });
}

function bindDelegates() {
  $('#toolbar').addEventListener('change', event => {
    if (event.target.id === 'statusFilter') {
      state.status = event.target.value || 'approved';
      state.selectedIds.clear();
      loadCurrent();
    } else if (event.target.id === 'categoryFilter') {
      state.category = event.target.value || '';
      renderAll();
    } else if (event.target.id === 'nsfwFilter') {
      state.nsfw = event.target.value || '';
      renderAll();
    }
  });
  $('#toolbar').addEventListener('click', event => {
    const feedbackStatus = event.target.closest('[data-feedback-status]');
    if (feedbackStatus) {
      state.feedbackStatus = feedbackStatus.dataset.feedbackStatus || 'pending';
      loadCurrent();
      return;
    }
    const batch = event.target.closest('[data-batch-action]');
    if (batch) runBatch(batch.dataset.batchAction);
    if (event.target.closest('[data-reload]')) loadCurrent();
  });
  $('#list').addEventListener('click', event => {
    const checkbox = event.target.closest('[data-select-id]');
    if (checkbox) {
      const id = checkbox.dataset.selectId;
      if (checkbox.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      renderToolbar();
      return;
    }
    const feedbackPick = event.target.closest('[data-pick-feedback], [data-feedback-id]');
    if (feedbackPick && state.view === 'feedback') {
      state.selectedFeedbackId = feedbackPick.dataset.pickFeedback || feedbackPick.dataset.feedbackId || '';
      renderList();
      renderDetail();
      return;
    }
    const pick = event.target.closest('[data-pick-id], [data-id]');
    if (pick && state.view !== 'feedback') {
      state.selectedId = pick.dataset.pickId || pick.dataset.id || '';
      renderList();
      renderDetail();
    }
  });
  $('#detail').addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action) runCommunityAction(action.dataset.action);
    const feedback = event.target.closest('[data-feedback-action]');
    if (feedback) runFeedbackAction(feedback.dataset.feedbackAction);
    const copy = event.target.closest('[data-copy-feedback]');
    if (copy) copyFeedback(copy.dataset.copyFeedback);
  });
}

async function loadCurrent() {
  $('#list').innerHTML = '<div class="empty-state">加载中...</div>';
  $('#empty').hidden = true;
  try {
    await loadStatsSoft();
    if (state.view === 'dashboard') {
      state.items = [];
      state.feedbackItems = [];
    } else if (state.view === 'feedback') {
      const data = await getFeedback(state.feedbackStatus);
      state.feedbackItems = data.items || [];
      if (!state.feedbackItems.some(item => item.id === state.selectedFeedbackId)) {
        state.selectedFeedbackId = state.feedbackItems[0]?.id || '';
      }
    } else {
      const data = await getCommunity(state.status);
      state.items = data.items || [];
      if (!state.items.some(item => item.id === state.selectedId)) {
        state.selectedId = state.items[0]?.id || '';
      }
      for (const id of Array.from(state.selectedIds)) {
        if (!state.items.some(item => item.id === id)) state.selectedIds.delete(id);
      }
    }
    renderAll();
  } catch (error) {
    handleError(error);
  }
}

async function loadStatsSoft() {
  try {
    state.stats = await getStats();
  } catch (error) {
    if (error.unauthorized) throw error;
  }
}

async function runCommunityAction(action) {
  const item = selectedItem();
  if (!item) return;
  const destructive = ['reject', 'unpublish', 'delete', 'purge'].includes(action);
  if (destructive && !confirm(confirmText(action, item))) return;
  const body = { id: item.id, status: item.status };
  if (['update', 'approve', 'publish'].includes(action)) body.edits = collectCommunityEdits();
  if (action === 'restore') body.targetStatus = 'hidden';
  try {
    await mutateCommunity(action, body);
    toast(actionLabel(action));
    state.selectedIds.delete(item.id);
    await loadCurrent();
  } catch (error) {
    handleError(error);
  }
}

async function runBatch(action) {
  const ids = Array.from(state.selectedIds);
  if (!ids.length) {
    toast('先勾选要操作的内容');
    return;
  }
  const body = { action, ids, status: state.status };
  if (action === 'moveCategory') {
    const category = $('#batchCategory')?.value || '';
    if (!category) {
      toast('请选择目标分类');
      return;
    }
    body.category = category;
  } else if (!confirm(`确认对 ${ids.length} 条内容执行「${actionLabel(action)}」？`)) {
    return;
  }
  try {
    const data = await mutateCommunity('batch', body);
    state.selectedIds.clear();
    const failed = (data.errors || []).length;
    toast(failed ? `完成 ${data.changed} 条，失败 ${failed} 条` : `已处理 ${data.changed} 条`);
    await loadCurrent();
  } catch (error) {
    handleError(error);
  }
}

async function runFeedbackAction(action) {
  const item = selectedFeedback();
  if (!item) return;
  try {
    if (action === 'delete') {
      if (!confirm('确认永久删除这条反馈？')) return;
      await deleteFeedback(item.id, state.feedbackStatus);
      toast('反馈已删除');
    } else {
      if (action === 'ignore' && !confirm('确认忽略这条反馈？')) return;
      await decideFeedback(item.id, action);
      toast(action === 'resolve' ? '已标记处理' : '已忽略');
    }
    await loadCurrent();
  } catch (error) {
    handleError(error);
  }
}

async function copyFeedback(id) {
  const item = state.feedbackItems.find(entry => entry.id === id);
  if (!item) return;
  const ctx = item.context || {};
  const entry = ctx.entry || {};
  const page = ctx.page || {};
  const lines = [
    '【法典图鉴反馈】',
    `类型：${item.typeLabel || item.type}`,
    `描述：${item.description}`,
    `联系方式：${item.contact || '未填写'}`,
    `页面：${page.url || ''}`,
    `词条：${entry.title || entry.id || ''}`,
    '',
    '【完整上下文】',
    JSON.stringify(ctx, null, 2),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(lines);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = lines;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  toast('反馈上下文已复制');
}

function syncTheme() {
  const dark = localStorage.getItem('strings-dark') === 'true' || document.documentElement.classList.contains('dark');
  document.body.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('dark', dark);
}

function handleError(error) {
  if (error.unauthorized) {
    showLogin(error.message);
    return;
  }
  $('#list').innerHTML = `<div class="empty-state">加载失败：${error.message || '未知错误'}</div>`;
  toast(error.message || '操作失败');
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

function confirmText(action, item) {
  const title = item.title || item.id;
  if (action === 'reject') return `确认拒绝「${title}」并移入已拒绝留档？`;
  if (action === 'unpublish') return `确认下架「${title}」？图片会保留。`;
  if (action === 'delete') return `确认软删除「${title}」？之后仍可恢复。`;
  if (action === 'purge') return `确认永久删除「${title}」？记录和图片都会删除。`;
  return `确认操作「${title}」？`;
}

function actionLabel(action) {
  return ({
    update: '已保存',
    approve: '已通过并发布',
    reject: '已拒绝留档',
    publish: '已上架',
    unpublish: '已下架',
    delete: '已软删除',
    restore: '已恢复',
    purge: '已永久删除',
    moveCategory: '移动分类',
  }[action] || STATUS_LABELS[action] || FEEDBACK_LABELS[action] || action);
}
