import { closeMask, isMaskOpen, openMask, trapFocus } from '../app/modal.js';
import { toast } from '../app/feedback.js';
import { $, copyText, escAttr, escHtml, imageUrl } from './utils.js';

let detailMask;
let detailBody;
let activeEntry = null;
let activeImageIndex = 0;
let detailSeq = 0; // 原图垫底加载的换图守卫（对齐主站灯箱做法）

export function initDetailDialog() {
  detailMask = $('#detailMask');
  detailBody = $('#detailBody');
  if (!detailMask || !detailBody) return;

  detailMask.addEventListener('click', event => {
    if (event.target === detailMask) closeCommunityDetail();
  });
  detailMask.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCommunityDetail();
      return;
    }
    trapFocus(event, detailMask);
  });
}

export function openCommunityDetail(entry, imageIndex = 0) {
  if (!detailMask || !detailBody || !entry) return;
  activeEntry = entry;
  activeImageIndex = Math.max(0, Math.min(imageIndex, (entry.images || []).length - 1));
  renderDetail();
  openMask(detailMask);
}

export function closeCommunityDetail() {
  if (!detailMask || !isMaskOpen(detailMask)) return;
  closeMask(detailMask);
}

function renderDetail() {
  const entry = activeEntry;
  const category = entry.category?.[0] || '随手分享';
  const images = entry.images || [];
  const current = images[activeImageIndex];
  const title = entry.title || category + '分享';
  const currentUrl = current ? imageUrl(current.file) : '';
  const originalUrl = current?.original ? imageUrl(current.original) : '';
  const params = current?.params || null;
  const paramsTitle = params
    ? `生成参数读取自 ${params.source || '图片'}${params.via === 'stealth' ? '（隐写通道）' : ''}，原图已原样保留`
    : '';

  detailBody.innerHTML = `
    <button class="dialog-close" type="button" data-close-detail aria-label="关闭">×</button>
    <div class="community-detail-shell">
      <section class="community-detail-media${images.length > 1 ? ' has-thumbs' : ''}" aria-label="投稿图片">
        ${current ? `<div class="community-detail-stage"><img id="detailImage" src="${escAttr(currentUrl)}" alt="${escAttr(title)}" decoding="async"></div>` : '<div class="community-detail-stage community-detail-stage-empty"><div class="community-detail-no-image">这条投稿没有例图</div></div>'}
        ${params || originalUrl ? `<div class="community-detail-mediabar">
          ${params ? `<span class="orig-param-badge" title="${escAttr(paramsTitle)}">✦ 原图 · 含生成参数</span>` : ''}
          ${originalUrl ? `<a class="orig-link" href="${escAttr(originalUrl)}" target="_blank" rel="noopener">查看原图</a>` : ''}
        </div>` : ''}
        ${entry.nsfw ? '<span class="nsfw-badge">NSFW</span>' : ''}
        ${images.length > 1 ? `<div class="community-detail-thumbs">${images.map((image, index) => `
          <button type="button" class="community-detail-thumb${index === activeImageIndex ? ' active' : ''}" data-image-index="${index}" aria-label="查看第 ${index + 1} 张图">
            <img src="${escAttr(imageUrl(image.file))}" alt="">
          </button>`).join('')}</div>` : ''}
      </section>
      <section class="community-detail-copy">
        <div class="community-detail-kicker">${escHtml(category)}${entry.submitter ? ` · 投稿人 ${escHtml(entry.submitter)}` : ''}</div>
        <h2 id="detailTitle">${escHtml(title)}</h2>
        ${(entry.tags || []).length ? `<div class="community-detail-tags">${entry.tags.map(tag => `<span>${escHtml(tag)}</span>`).join('')}</div>` : ''}
        <div class="prompt-section">
          <div class="prompt-heading"><span>Prompt</span><button type="button" data-copy="prompt">复制</button></div>
          <pre>${escHtml(entry.prompt || '')}</pre>
        </div>
        ${entry.negative ? `<div class="prompt-section">
          <div class="prompt-heading"><span>Negative</span><button type="button" data-copy="negative">复制</button></div>
          <pre>${escHtml(entry.negative)}</pre>
        </div>` : ''}
        ${entry.comment ? `<div class="community-detail-comment"><h3>说明</h3><p>${escHtml(entry.comment)}</p></div>` : ''}
      </section>
    </div>
  `;

  // 垫底加载：压缩图先上屏，原图加载完成后无缝替换（与主站灯箱同思路）
  const seq = ++detailSeq;
  const stageImg = detailBody.querySelector('#detailImage');
  if (stageImg && originalUrl && originalUrl !== currentUrl) {
    const pre = new Image();
    pre.onload = () => {
      if (seq === detailSeq && stageImg.isConnected) stageImg.src = originalUrl;
    };
    pre.src = originalUrl;
  }

  detailBody.querySelector('[data-close-detail]')?.addEventListener('click', closeCommunityDetail);
  detailBody.querySelectorAll('[data-image-index]').forEach(button => {
    button.addEventListener('click', () => {
      activeImageIndex = Number(button.dataset.imageIndex) || 0;
      renderDetail();
    });
  });
  detailBody.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const type = button.dataset.copy;
      await copyText(type === 'negative' ? entry.negative : entry.prompt);
      toast(type === 'negative' ? '已复制负面 Prompt' : '已复制 Prompt');
    });
  });
}
