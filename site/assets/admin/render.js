import {
  $, state, COMMUNITY_CATEGORIES, COMMUNITY_STATUSES, STATUS_LABELS, FEEDBACK_LABELS,
  escHtml, escAttr, formatDate, currentItems, selectedItem, selectedFeedback, pluralCount,
} from './state.js';
import { renderCommunityDetail, renderFeedbackDetail } from './editor.js';

export function renderAll() {
  renderHeader();
  renderNav();
  renderDashboard();
  renderToolbar();
  renderList();
  renderDetail();
}

export function renderHeader() {
  const titles = {
    dashboard: ['Dashboard', '总览'],
    review: ['Moderation', '投稿审核'],
    content: ['Library', '内容管理'],
    feedback: ['Feedback', '反馈处理'],
  };
  const [kicker, title] = titles[state.view] || titles.dashboard;
  $('#viewKicker').textContent = kicker;
  $('#viewTitle').textContent = title;
  const meta = $('#viewMeta');
  if (state.view === 'dashboard') meta.textContent = state.stats ? `更新于 ${formatDate(state.stats.generatedAt)}` : '';
  else if (state.view === 'feedback') meta.textContent = `${FEEDBACK_LABELS[state.feedbackStatus]} · ${state.feedbackItems.length} 条`;
  else meta.textContent = `${STATUS_LABELS[state.status]} · ${currentItems().length} / ${state.items.length} 条`;
}

export function renderNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.view === state.view);
  });
  const counts = state.stats && state.stats.counts || {};
  $('#navDashCount').textContent = pluralCount(state.stats && state.stats.total);
  $('#navPendingCount').textContent = pluralCount(counts.pending);
  $('#navContentCount').textContent = pluralCount((counts.approved || 0) + (counts.hidden || 0) + (counts.rejected || 0) + (counts.deleted || 0));
  $('#navFeedbackCount').textContent = state.view === 'feedback' ? pluralCount(state.feedbackItems.length) : '-';
}

export function renderDashboard() {
  const panel = $('#dashboardPanel');
  panel.hidden = state.view !== 'dashboard';
  if (state.view !== 'dashboard') {
    panel.innerHTML = '';
    return;
  }
  const stats = state.stats || { counts: {}, categories: {}, nsfw: 0, images: 0, total: 0 };
  const counts = stats.counts || {};
  const cats = stats.categories || {};
  const maxCat = Math.max(1, ...Object.values(cats).map(Number));
  panel.innerHTML = `
    <div class="stat-grid">
      ${statCard('全部内容', stats.total)}
      ${statCard('待审', counts.pending)}
      ${statCard('已发布', counts.approved)}
      ${statCard('已下架', counts.hidden)}
      ${statCard('图片数', stats.images)}
    </div>
    <div class="dash-split">
      <section class="dash-box">
        <h2>分类分布</h2>
        ${COMMUNITY_CATEGORIES.map(cat => barRow(cat, cats[cat] || 0, maxCat)).join('') || '<p class="toolbar-note">暂无分类数据</p>'}
      </section>
      <section class="dash-box">
        <h2>待办</h2>
        <div class="todo-list">
          ${todoItem('待审投稿', counts.pending || 0)}
          ${todoItem('反馈待处理', state.feedbackStatus === 'pending' ? state.feedbackItems.length : '-')}
          ${todoItem('NSFW 内容', stats.nsfw || 0)}
          ${todoItem('软删除留档', counts.deleted || 0)}
        </div>
      </section>
    </div>`;
}

export function renderToolbar() {
  const toolbar = $('#toolbar');
  if (state.view === 'dashboard') {
    toolbar.innerHTML = '';
    toolbar.hidden = true;
    return;
  }
  toolbar.hidden = false;
  if (state.view === 'feedback') {
    toolbar.innerHTML = `
      <div class="segmented">
        ${Object.entries(FEEDBACK_LABELS).map(([key, label]) => `<button type="button" data-feedback-status="${key}" class="${state.feedbackStatus === key ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <span class="toolbar-note">${pluralCount(state.feedbackItems.length)} 条反馈</span>
      <span class="spacer"></span>
      <button class="soft-btn" type="button" data-reload>刷新反馈</button>`;
    return;
  }

  const statusSelect = state.view === 'content'
    ? `<select id="statusFilter" aria-label="状态">${COMMUNITY_STATUSES.filter(s => s !== 'pending').map(status => `<option value="${status}"${state.status === status ? ' selected' : ''}>${STATUS_LABELS[status]}</option>`).join('')}</select>`
    : `<span class="toolbar-note">待审队列</span>`;
  toolbar.innerHTML = `
    ${statusSelect}
    <select id="categoryFilter" aria-label="分类">
      <option value="">全部分类</option>
      ${COMMUNITY_CATEGORIES.map(cat => `<option value="${escAttr(cat)}"${state.category === cat ? ' selected' : ''}>${escHtml(cat)}</option>`).join('')}
    </select>
    <select id="nsfwFilter" aria-label="分级">
      <option value="">全部分级</option>
      <option value="sfw"${state.nsfw === 'sfw' ? ' selected' : ''}>只看 SFW</option>
      <option value="nsfw"${state.nsfw === 'nsfw' ? ' selected' : ''}>只看 NSFW</option>
    </select>
    <span class="toolbar-note">已选 ${state.selectedIds.size} 条</span>
    <span class="spacer"></span>
    <select id="batchCategory" aria-label="批量分类">
      <option value="">移动分类</option>
      ${COMMUNITY_CATEGORIES.map(cat => `<option value="${escAttr(cat)}">${escHtml(cat)}</option>`).join('')}
    </select>
    <button class="soft-btn" type="button" data-batch-action="moveCategory">应用分类</button>
    <button class="soft-btn" type="button" data-batch-action="publish">批量上架</button>
    <button class="soft-btn" type="button" data-batch-action="unpublish">批量下架</button>
    <button class="danger-btn" type="button" data-batch-action="delete">批量删除</button>
    <button class="danger-btn" type="button" data-batch-action="purge">永久删除</button>`;
}

export function renderList() {
  const list = $('#list');
  const empty = $('#empty');
  if (state.view === 'dashboard') {
    list.innerHTML = '';
    empty.hidden = true;
    return;
  }
  if (state.view === 'feedback') {
    list.innerHTML = state.feedbackItems.map(feedbackRow).join('');
    empty.hidden = state.feedbackItems.length > 0;
    return;
  }
  const items = currentItems();
  list.innerHTML = items.map(contentRow).join('');
  empty.hidden = items.length > 0;
}

export function renderDetail() {
  const detail = $('#detail');
  if (state.view === 'feedback') detail.innerHTML = renderFeedbackDetail(selectedFeedback());
  else if (state.view === 'dashboard') detail.innerHTML = `<div class="detail-empty"><b>运营提示</b><span>切到投稿审核或内容管理后，可以在这里编辑条目。</span></div>`;
  else detail.innerHTML = renderCommunityDetail(selectedItem());
}

function contentRow(item) {
  const img = (item.images || [])[Number(item.coverIndex || 0)] || (item.images || [])[0];
  const category = (item.category || [])[0] || '随手分享';
  const checked = state.selectedIds.has(item.id) ? ' checked' : '';
  return `
    <article class="content-row ${state.selectedId === item.id ? 'on' : ''}" data-id="${escAttr(item.id)}">
      <input type="checkbox" data-select-id="${escAttr(item.id)}"${checked} aria-label="选择 ${escAttr(item.title)}">
      ${img ? `<img class="thumb" src="${escAttr(img.file)}" loading="lazy" alt="">` : '<div class="thumb empty">无图</div>'}
      <div class="row-main">
        <div class="row-title">
          <b>${escHtml(item.title || '未命名投稿')}</b>
          <span class="badge accent">${escHtml(category)}</span>
          ${item.nsfw ? '<span class="badge red">NSFW</span>' : ''}
        </div>
        <div class="row-meta">
          <span>${escHtml(item.submitter || '匿名')}</span>
          <span>${(item.images || []).length} 张图</span>
          <span>${escHtml(formatDate(item.createdAt, false))}</span>
          <span>${escHtml(STATUS_LABELS[item.status] || item.status)}</span>
        </div>
        <div class="row-prompt">${escHtml(item.prompt || item.comment || '无 prompt')}</div>
      </div>
      <div class="row-actions">
        <button class="mini-btn" type="button" data-pick-id="${escAttr(item.id)}">详情</button>
      </div>
    </article>`;
}

function feedbackRow(item) {
  const ctx = item.context || {};
  const entry = ctx.entry || {};
  return `
    <article class="content-row feedback-row ${state.selectedFeedbackId === item.id ? 'on' : ''}" data-feedback-id="${escAttr(item.id)}">
      <span class="badge accent">${escHtml(item.typeLabel || item.type || '反馈')}</span>
      <div class="row-main">
        <div class="row-title"><b>${escHtml(item.description || '无描述')}</b></div>
        <div class="row-meta">
          <span>${escHtml(formatDate(item.createdAt))}</span>
          <span>${escHtml(item.contact || '未留联系方式')}</span>
          <span class="fb-context-chip">${escHtml(entry.title || entry.id || '无关联词条')}</span>
        </div>
      </div>
      <div class="row-actions">
        <button class="mini-btn" type="button" data-pick-feedback="${escAttr(item.id)}">详情</button>
      </div>
    </article>`;
}

function statCard(label, value) {
  return `<section class="stat-card"><span>${escHtml(label)}</span><b>${pluralCount(value)}</b></section>`;
}

function barRow(label, value, max) {
  const n = Number(value || 0);
  const pct = n ? Math.max(3, Math.round((n / max) * 100)) : 0;
  return `<div class="bar-row"><span>${escHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><b>${pluralCount(value)}</b></div>`;
}

function todoItem(label, value) {
  return `<div class="todo-item"><span>${escHtml(label)}</span><b>${escHtml(pluralCount(value))}</b></div>`;
}
