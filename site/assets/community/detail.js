import { closeMask, isMaskOpen, openMask, trapFocus } from '../app/modal.js';
import { toast } from '../app/feedback.js';
import { $, copyText, escAttr, escHtml, imageUrl } from './utils.js';

let detailMask;
let detailBody;
let activeEntry = null;
let activeImageIndex = 0;

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

  detailBody.innerHTML = `
    <button class="dialog-close" type="button" data-close-detail aria-label="关闭">×</button>
    <div class="community-detail-shell">
      <section class="community-detail-media${images.length > 1 ? ' has-thumbs' : ''}" aria-label="投稿图片">
        ${current ? `<div class="community-detail-stage"><img id="detailImage" src="${escAttr(currentUrl)}" alt="${escAttr(title)}"></div>` : '<div class="community-detail-stage community-detail-stage-empty"><div class="community-detail-no-image">这条投稿没有例图</div></div>'}
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
