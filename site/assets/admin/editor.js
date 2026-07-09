import {
  COMMUNITY_CATEGORIES, STATUS_LABELS, escHtml, escAttr, formatDate,
} from './state.js';

export function renderCommunityDetail(item) {
  if (!item) {
    return `<div class="detail-empty"><b>选择一条内容</b><span>右侧会显示完整信息、编辑表单和管理动作。</span></div>`;
  }
  const status = item.status || 'pending';
  const coverIndex = Number(item.coverIndex || 0);
  return `
    <div class="detail-head">
      <div>
        <h2>${escHtml(item.title || '未命名投稿')}</h2>
        <p>${escHtml(STATUS_LABELS[status] || status)} · ${escHtml(formatDate(item.updatedAt || item.createdAt))}</p>
      </div>
      <span class="badge ${item.nsfw ? 'red' : 'accent'}">${item.nsfw ? 'NSFW' : 'SFW'}</span>
    </div>
    <div class="image-grid">
      ${(item.images || []).map((image, index) => `
        <div class="image-choice">
          <a href="${escAttr(image.file)}" target="_blank" rel="noopener">
            <img src="${escAttr(image.file)}" loading="lazy" alt="">
          </a>
          <label><input type="radio" name="coverIndex" value="${index}"${index === coverIndex ? ' checked' : ''}>封面 ${index + 1}</label>
        </div>
      `).join('') || '<div class="thumb empty">无图</div>'}
    </div>
    <form class="editor-form" id="editorForm">
      <div class="field-row">
        ${field('标题', 'editTitle', 'input', item.title || '', '不填自动生成')}
        ${field('投稿人', 'editSubmitter', 'input', item.submitter || '', '匿名')}
      </div>
      ${field('Prompt', 'editPrompt', 'textarea-mono', item.prompt || '')}
      ${field('负面 Prompt', 'editNegative', 'textarea-mono', item.negative || '')}
      <div class="field-row">
        <label class="field">分类${categorySelect(item.category)}</label>
        ${field('标签（逗号分隔）', 'editTags', 'input', (item.tags || []).join(', '))}
      </div>
      ${field('说明', 'editComment', 'textarea', item.comment || '')}
      ${field('管理备注', 'editAdminNote', 'textarea', item.adminNote || '')}
      <label class="check-line"><input type="checkbox" id="editNsfw"${item.nsfw ? ' checked' : ''}>标记为 NSFW</label>
    </form>
    <div class="detail-actions">
      ${communityActions(status)}
    </div>
  `;
}

export function collectCommunityEdits() {
  const cover = document.querySelector('input[name="coverIndex"]:checked');
  return {
    title: valueOf('editTitle'),
    submitter: valueOf('editSubmitter'),
    prompt: valueOf('editPrompt'),
    negative: valueOf('editNegative'),
    category: valueOf('editCategory'),
    tags: valueOf('editTags'),
    comment: valueOf('editComment'),
    adminNote: valueOf('editAdminNote'),
    nsfw: !!document.getElementById('editNsfw')?.checked,
    coverIndex: cover ? Number(cover.value || 0) : 0,
  };
}

export function renderFeedbackDetail(item) {
  if (!item) {
    return `<div class="detail-empty"><b>选择一条反馈</b><span>右侧会显示上下文和处理动作。</span></div>`;
  }
  const ctx = item.context || {};
  const entry = ctx.entry || {};
  const page = ctx.page || {};
  const codex = ctx.codex || {};
  return `
    <div class="detail-head">
      <div>
        <h2>${escHtml(item.typeLabel || item.type || '反馈')}</h2>
        <p>${escHtml(formatDate(item.createdAt))}</p>
      </div>
      <span class="badge accent">${escHtml(item.status || 'pending')}</span>
    </div>
    <div class="editor-form">
      <div class="field"><label>反馈内容</label><div class="copy-block">${escHtml(item.description || '')}</div></div>
      <div class="field-row">
        <div class="field"><label>联系方式</label><input readonly value="${escAttr(item.contact || '未填写')}"></div>
        <div class="field"><label>法典</label><input readonly value="${escAttr(codex.title || codex.id || '无')}"></div>
      </div>
      <div class="field"><label>词条</label><input readonly value="${escAttr(entry.title || entry.id || '无')}"></div>
      <div class="field"><label>页面 URL</label><input readonly value="${escAttr(page.url || '')}"></div>
      <div class="field"><label>完整上下文</label><div class="copy-block">${escHtml(JSON.stringify(ctx, null, 2))}</div></div>
    </div>
    <div class="detail-actions">
      <button class="soft-btn" type="button" data-copy-feedback="${escAttr(item.id)}">复制上下文</button>
      ${item.status === 'pending' ? '<button class="primary-btn" type="button" data-feedback-action="resolve">标记已处理</button><button class="danger-btn" type="button" data-feedback-action="ignore">忽略</button>' : ''}
      <button class="danger-btn" type="button" data-feedback-action="delete">删除反馈</button>
    </div>
  `;
}

function field(label, id, type, value, placeholder = '') {
  if (type === 'textarea' || type === 'textarea-mono') {
    return `<label class="field">${escHtml(label)}<textarea id="${id}" class="${type === 'textarea-mono' ? 'mono' : ''}" placeholder="${escAttr(placeholder)}">${escHtml(value)}</textarea></label>`;
  }
  return `<label class="field">${escHtml(label)}<input id="${id}" type="text" value="${escAttr(value)}" placeholder="${escAttr(placeholder)}"></label>`;
}

function categorySelect(category) {
  const current = Array.isArray(category) ? category[0] : category;
  return `<select id="editCategory">${COMMUNITY_CATEGORIES.map(cat => `<option value="${escAttr(cat)}"${cat === current ? ' selected' : ''}>${escHtml(cat)}</option>`).join('')}</select>`;
}

function communityActions(status) {
  const save = '<button class="soft-btn" type="button" data-action="update">保存修改</button>';
  if (status === 'pending') {
    return `${save}<button class="primary-btn" type="button" data-action="approve">通过并发布</button><button class="danger-btn" type="button" data-action="reject">拒绝留档</button><button class="danger-btn" type="button" data-action="delete">删除</button>`;
  }
  if (status === 'approved') {
    return `${save}<button class="soft-btn" type="button" data-action="unpublish">下架</button><button class="danger-btn" type="button" data-action="delete">删除</button>`;
  }
  if (status === 'hidden') {
    return `${save}<button class="primary-btn" type="button" data-action="publish">重新上架</button><button class="danger-btn" type="button" data-action="delete">删除</button>`;
  }
  if (status === 'rejected') {
    return `${save}<button class="primary-btn" type="button" data-action="publish">改为发布</button><button class="danger-btn" type="button" data-action="delete">删除</button>`;
  }
  return `<button class="soft-btn" type="button" data-action="restore">恢复为下架</button><button class="primary-btn" type="button" data-action="publish">重新上架</button><button class="danger-btn" type="button" data-action="purge">永久删除</button>`;
}

function valueOf(id) {
  return document.getElementById(id)?.value || '';
}
