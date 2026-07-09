'use strict';

/* 共创广场投稿弹窗（自包含脚本，依赖 strings.js 里的全局 $ / toast） */
(() => {

// 与后端 functions/_lib.js 的 LIMITS 保持一致
const LIM = { title: 60, prompt: 2000, negative: 2000, comment: 500, submitter: 20, tags: 8, imgMax: 6, imgBytes: 3 * 1024 * 1024 };
const CATEGORIES = window.COMMUNITY_CATEGORIES || ['随手分享', '画风', '人物', '服装', '动作', '构图', '场景'];
const DEFAULT_CATEGORY = window.DEFAULT_COMMUNITY_CATEGORY || '随手分享';
const SUBMIT_CATEGORIES = [DEFAULT_CATEGORY, ...CATEGORIES.filter(c => c !== DEFAULT_CATEGORY)];

let modal = null;
let files = [];   // {blob, url}
let busy = false;
let metadataConsumed = false;

const CSS = `
.sub-field{margin-bottom:14px}
.sub-panel{scrollbar-width:none;-ms-overflow-style:none}
.sub-panel::-webkit-scrollbar{width:0;height:0}
.sub-field>label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px}
.sub-field-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.sub-field-head>label{font-size:12px;font-weight:700;color:var(--muted)}
.sub-label-src{display:inline-flex;align-items:center;gap:8px;min-width:0}
.sub-label-src>label{font-size:12px;font-weight:700;color:var(--muted)}
.sub-src{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;border-radius:6px;padding:2px 8px;white-space:nowrap}
.sub-src:empty{display:none}
.sub-src svg{width:12px;height:12px;flex:none}
.sub-src.is-manual{color:var(--muted);background:var(--tagbg)}
.sub-src.is-read{color:#0f6e56;background:#e1f5ee}
body.dark .sub-src.is-read{color:#8fe6c8;background:rgba(15,110,86,.30)}
.sub-src.is-none{color:#854f0b;background:#faeeda}
body.dark .sub-src.is-none{color:#f0c078;background:rgba(133,79,11,.32)}
.sub-field input[type=text],.sub-field textarea{width:100%;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box}
.sub-field textarea{resize:vertical;min-height:88px;line-height:1.6}
.sub-field textarea.mono{font-family:var(--font-mono);font-size:12px}
.sub-field input:focus,.sub-field textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
.sub-row{display:flex;gap:12px;flex-wrap:wrap}
.sub-row .sub-field{flex:1;min-width:150px}
.sub-drop{border:2px dashed var(--line);border-radius:14px;padding:18px 14px;text-align:center;color:var(--muted);font-size:13px;cursor:pointer;transition:all .15s;background:var(--tagbg)}
.sub-drop-main{min-height:144px;display:grid;place-items:center;gap:6px}
.sub-drop-main strong{display:block;color:var(--text);font-size:16px}
.sub-drop-main span{display:block;color:var(--muted);font-size:12px}
.sub-drop:hover,.sub-drop.over{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.sub-drop:hover strong,.sub-drop.over strong{color:var(--accent)}
.sub-previews{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px;margin-top:10px}
.sub-prev{position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--tagbg)}
.sub-prev img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.sub-prev-meta{padding:5px 7px;font-size:11px;color:var(--muted);background:var(--card);border-top:1px solid var(--line)}
.sub-prev .rm{position:absolute;top:4px;right:4px;width:22px;height:22px;border:none;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;cursor:pointer;display:grid;place-items:center;line-height:1}
.sub-prev .rm:hover{background:var(--red)}
.sub-cat-list{display:flex;gap:8px;flex-wrap:wrap}
.sub-cat{border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;font-family:inherit;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.sub-cat:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.sub-cat.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
.sub-more{border:1px solid var(--line);border-radius:12px;background:var(--tagbg);padding:0;margin-top:4px}
.sub-more summary{list-style:none;cursor:pointer;padding:11px 13px;color:var(--text);font-size:13px;font-weight:800;user-select:none}
.sub-more summary span{margin-left:8px;color:var(--muted);font-size:12px;font-weight:600}
.sub-more summary::-webkit-details-marker{display:none}
.sub-more summary::after{content:'+';float:right;color:var(--accent);font-weight:900}
.sub-more[open] summary::after{content:'-'}
.sub-more-body{padding:0 13px 13px}
.sub-check{display:inline-flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;user-select:none;padding:9px 0}
.sub-field-head .sub-check{padding:0;font-size:12px;color:var(--muted);font-weight:700;white-space:nowrap}
.sub-check input{accent-color:var(--red);width:15px;height:15px}
.sub-actions{display:flex;align-items:center;gap:12px;margin-top:16px;flex-wrap:wrap}
.sub-go{border:none;background:var(--accent);color:#fff;font-weight:800;font-size:14px;padding:11px 28px;border-radius:10px;cursor:pointer;font-family:inherit;transition:filter .15s}
.sub-go:hover{filter:brightness(1.08)}
.sub-go:disabled{opacity:.55;cursor:not-allowed;filter:none}
.sub-err{color:var(--red);font-size:12px;flex:1;min-width:150px}
.sub-note{font-size:12px;color:var(--muted);line-height:1.7;margin-top:6px}
`;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildModal() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  modal = document.createElement('div');
  modal.className = 'detail-overlay';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="detail-panel sub-panel" style="max-width:720px">
      <button class="detail-close" id="subClose">✕</button>
      <div class="detail-body">
        <h2 class="detail-title" style="margin-bottom:4px">投稿到共创广场</h2>
        <div class="sub-note" style="margin-bottom:18px">分享任意 NovelAI 作品。可以是画风、人物、服装、动作、构图、场景，也可以只是你的今日最爱。</div>

        <div class="sub-field">
          <label>作品 *</label>
          <div class="sub-drop sub-drop-main" id="subDrop">
            <div>
              <strong>拖入作品，或点击选择</strong>
              <span>1-${LIM.imgMax} 张，会自动读取图片中的 prompt </span>
            </div>
          </div>
          <input type="file" id="subFile" accept="image/*" multiple hidden>
          <div class="sub-previews" id="subPreviews"></div>
        </div>

        <div class="sub-field">
          <div class="sub-field-head">
            <span class="sub-label-src"><label>Prompt *</label><span id="subPromptSrc" class="sub-src is-manual"></span></span>
            <label class="sub-check"><input type="checkbox" id="subNsfw">包含 NSFW 内容</label>
          </div>
          <textarea id="subPrompt" class="mono" maxlength="${LIM.prompt}" placeholder="粘贴正向 prompt，例如 artist:xxx, cinematic lighting, dynamic pose, ..."></textarea>
        </div>

        <div class="sub-row">
          <div class="sub-field">
            <label>标题</label>
            <input type="text" id="subTitle" maxlength="${LIM.title}" placeholder="不填会自动生成">
          </div>
          <div class="sub-field">
            <label>投稿者名</label>
            <input type="text" id="subName" maxlength="${LIM.submitter}" placeholder="匿名">
          </div>
        </div>

        <div class="sub-field">
          <label>分类</label>
          <div class="sub-cat-list" id="subCategoryList">
            ${SUBMIT_CATEGORIES.map(c => `<button type="button" class="sub-cat${c === DEFAULT_CATEGORY ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
          <input type="hidden" id="subCategory" value="${esc(DEFAULT_CATEGORY)}">
        </div>

        <details class="sub-more" id="subMore">
          <summary>更多（可选）<span>负面 prompt · 说明 · 标签</span></summary>
          <div class="sub-more-body">
            <div class="sub-field">
              <label>负面 Prompt</label>
              <textarea id="subNegative" class="mono" maxlength="${LIM.negative}" placeholder="lowres, bad anatomy, extra fingers, ..."></textarea>
            </div>

            <div class="sub-row">
              <div class="sub-field">
                <label>标签（逗号分隔，最多 ${LIM.tags} 个）</label>
                <input type="text" id="subTags" maxlength="200" placeholder="如：暗色, 油画, 高对比">
              </div>
            </div>

            <div class="sub-field">
              <label>说明 / 使用心得</label>
              <textarea id="subComment" maxlength="${LIM.comment}" style="min-height:60px" placeholder="适合什么题材、推荐权重等"></textarea>
            </div>
          </div>
        </details>

        <div class="sub-actions">
          <button class="sub-go" id="subGo">提交投稿</button>
          <div class="sub-err" id="subErr"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  $('#subClose', modal).onclick = closeModal;

  const drop = $('#subDrop', modal);
  const fileInput = $('#subFile', modal);
  drop.onclick = () => fileInput.click();
  fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ''; };
  drop.ondragover = ev => { ev.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = ev => {
    ev.preventDefault();
    drop.classList.remove('over');
    addFiles([...(ev.dataTransfer?.files || [])]);
  };

  $('#subCategoryList', modal).onclick = ev => {
    const btn = ev.target.closest('.sub-cat');
    if (btn) setCategory(btn.dataset.cat);
  };
  $('#subGo', modal).onclick = doSubmit;
  setPromptSource('manual');  // 小标默认态；后续由图片是否含参数驱动（addFiles / 删图）
}

function openModal() {
  if (!modal) buildModal();
  showErr('');
  modal.style.display = '';
}

function closeModal() { modal.style.display = 'none'; }

function showErr(msg) { const el = $('#subErr', modal); if (el) el.textContent = msg || ''; }

function setCategory(cat) {
  const value = CATEGORIES.includes(cat) ? cat : DEFAULT_CATEGORY;
  $('#subCategory', modal).value = value;
  $$('#subCategoryList .sub-cat', modal).forEach(btn => btn.classList.toggle('on', btn.dataset.cat === value));
}

/* ---- 原图 PNG 元数据：读取 tEXt / 未压缩 iTXt 文本块，压缩前调用 ---- */
function decodePngText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('latin1').decode(bytes); }
}

function readPngType(raw, pos) {
  return String.fromCharCode(raw[pos], raw[pos + 1], raw[pos + 2], raw[pos + 3]);
}

function parsePngTextChunk(data) {
  const sep = data.indexOf(0);
  if (sep < 0) return null;
  return {
    keyword: decodePngText(data.subarray(0, sep)),
    text: decodePngText(data.subarray(sep + 1)),
  };
}

function parsePngItxtChunk(data) {
  const firstSep = data.indexOf(0);
  if (firstSep < 0 || firstSep + 3 > data.length) return null;
  const keyword = decodePngText(data.subarray(0, firstSep));
  const compressed = data[firstSep + 1] === 1;
  let pos = firstSep + 3; // compression flag + method
  const langSep = data.indexOf(0, pos);
  if (langSep < 0) return null;
  pos = langSep + 1;
  const translatedSep = data.indexOf(0, pos);
  if (translatedSep < 0) return null;
  pos = translatedSep + 1;
  if (compressed) return null;
  return { keyword, text: decodePngText(data.subarray(pos)) };
}

function readPngTextChunks(buffer) {
  const raw = new Uint8Array(buffer);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (raw.length < sig.length || sig.some((b, i) => raw[i] !== b)) return [];
  const view = new DataView(buffer);
  const chunks = [];
  let pos = 8;
  while (pos + 12 <= raw.length) {
    const size = view.getUint32(pos, false);
    const type = readPngType(raw, pos + 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + size;
    const next = dataEnd + 4;
    if (dataEnd > raw.length || next > raw.length) break;
    const data = raw.subarray(dataStart, dataEnd);
    const parsed = type === 'tEXt' ? parsePngTextChunk(data) : (type === 'iTXt' ? parsePngItxtChunk(data) : null);
    if (parsed && parsed.keyword) chunks.push({ type, ...parsed });
    pos = next;
    if (type === 'IEND') break;
  }
  return chunks;
}

function splitWebuiParameters(text) {
  const idx = text.indexOf('Steps: ');
  const prompts = idx >= 0 ? text.slice(0, idx) : text;
  const negMarker = 'Negative prompt:';
  const negIdx = prompts.indexOf(negMarker);
  if (negIdx < 0) return { prompt: prompts.trim(), negative: '' };
  return {
    prompt: prompts.slice(0, negIdx).trim(),
    negative: prompts.slice(negIdx + negMarker.length).trim(),
  };
}

function naiV4CaptionText(data, key) {
  const node = data && typeof data === 'object' ? data[key] : null;
  const caption = node && typeof node === 'object' && node.caption && typeof node.caption === 'object' ? node.caption : {};
  const parts = [];
  if (caption.base_caption) parts.push(String(caption.base_caption));
  for (const item of caption.char_captions || []) {
    if (item && typeof item === 'object' && item.char_caption) parts.push(String(item.char_caption));
  }
  return parts.join('\n').trim();
}

function promptFromPngChunks(chunks) {
  const fields = {};
  for (const c of chunks) fields[c.keyword] = c.text;
  let prompt = '';
  let negative = '';
  let source = fields.Software || fields.Source || 'PNG';

  if (fields.Comment) {
    try {
      const comment = JSON.parse(fields.Comment);
      prompt = naiV4CaptionText(comment, 'v4_prompt') || String(comment.prompt || '');
      negative = naiV4CaptionText(comment, 'v4_negative_prompt') || String(comment.uc || comment.negative_prompt || '');
      if (fields.Software === 'NovelAI' || prompt || negative) source = 'NovelAI';
    } catch {
      // 普通文本 Comment 不是错误，继续尝试 Description / parameters。
    }
  }

  if (!prompt && fields.Description) {
    prompt = fields.Description;
    if (fields.Software === 'NovelAI' || fields.Source === 'NovelAI' || fields.Comment) source = 'NovelAI';
  }

  if (!prompt && fields.parameters) {
    const sd = splitWebuiParameters(fields.parameters);
    prompt = sd.prompt;
    negative = sd.negative;
    source = 'SD-WEBUI';
  }

  prompt = prompt.trim();
  negative = negative.trim();
  return prompt || negative ? { prompt, negative, source } : null;
}

async function readImagePrompt(file) {
  if (!file || (!/^image\/png$/i.test(file.type || '') && !/\.png$/i.test(file.name || ''))) return null;
  const buffer = await file.arrayBuffer();
  const chunks = readPngTextChunks(buffer);
  return chunks.length ? promptFromPngChunks(chunks) : null;
}

/* prompt 来源小标三态：手动填写（灰）· 已从图片读出（绿·三星）· 图中未含参数（琥珀）。拖图后即时反馈图里到底有没有参数 */
const PROMPT_SRC = {
  manual: { cls: 'is-manual', text: '手动填写', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' },
  read: { cls: 'is-read', text: '已从图片读出', icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.5 3l1.3 3.4 3.4 1.3-3.4 1.3-1.3 3.4-1.3-3.4L6.8 8.7l3.4-1.3z"/><path d="M18 12.3l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path d="M6 13.6l.65 1.7 1.7.65-1.7.65L6 18.3l-.65-1.7L3.65 16l1.7-.65z"/></svg>' },
  none: { cls: 'is-none', text: '图中未含参数', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6h.01"/></svg>' },
};
function setPromptSource(key) {
  if (!modal) return;
  const el = $('#subPromptSrc', modal);
  if (!el) return;
  const s = PROMPT_SRC[key] || PROMPT_SRC.manual;
  el.className = 'sub-src ' + s.cls;
  el.innerHTML = `${s.icon}<span>${s.text}</span>`;
}

function fillPromptFromMetadata(meta) {
  if (!meta || !modal) return false;
  let filled = false;
  const promptEl = $('#subPrompt', modal);
  const negativeEl = $('#subNegative', modal);
  if (meta.prompt && promptEl && !promptEl.value.trim()) {
    promptEl.value = meta.prompt.slice(0, LIM.prompt);
    filled = true;
  }
  if (meta.negative && negativeEl && !negativeEl.value.trim()) {
    negativeEl.value = meta.negative.slice(0, LIM.negative);
    filled = true;
  }
  if (filled) toast(`已从${meta.source || '图片'}读出 prompt，可修改`);
  return filled;
}

/* ---- 图片：浏览器端压缩（长边 ≤1100px JPEG，与站内缩略图规格一致） ---- */
async function compressImage(file) {
  const MAX = 1100;
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error('无法读取图片：' + (file.name || '')); }
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('图片压缩失败');
  if (blob.size > LIM.imgBytes) throw new Error('图片压缩后仍过大');
  return blob;
}

async function addFiles(list) {
  for (const f of list) {
    if (files.length >= LIM.imgMax) { showErr(`例图最多 ${LIM.imgMax} 张`); break; }
    if (!/^image\//.test(f.type)) continue;
    try {
      if (!metadataConsumed) {
        const meta = await readImagePrompt(f).catch(() => null);
        if (meta) {
          metadataConsumed = true;
          fillPromptFromMetadata(meta);
          setPromptSource('read');
        } else {
          setPromptSource('none');  // 这张图没读到参数，明确告诉用户（想读参数的知道要手填，只想分享 tag 的也安心）
        }
      }
      const blob = await compressImage(f);
      files.push({ blob, url: URL.createObjectURL(blob) });
      showErr('');
    } catch (e) {
      showErr(e.message || '图片处理失败');
    }
  }
  renderPreviews();
}

function renderPreviews() {
  const box = $('#subPreviews', modal);
  box.innerHTML = '';
  files.forEach((im, i) => {
    const div = document.createElement('div');
    div.className = 'sub-prev';
    div.innerHTML = `
      <img src="${im.url}" alt="">
      <button class="rm" title="移除">✕</button>
      <div class="sub-prev-meta">例图 ${i + 1}</div>`;
    div.querySelector('.rm').onclick = () => {
      URL.revokeObjectURL(im.url);
      files.splice(i, 1);
      if (!files.length) { metadataConsumed = false; setPromptSource('manual'); }  // 图删空了：回默认、允许下张重新读参数
      renderPreviews();
    };
    box.appendChild(div);
  });
}

function resetForm() {
  ['#subTitle', '#subPrompt', '#subNegative', '#subTags', '#subName', '#subComment'].forEach(s => { $(s, modal).value = ''; });
  setCategory(DEFAULT_CATEGORY);
  $('#subNsfw', modal).checked = false;
  $('#subMore', modal).open = false;
  metadataConsumed = false;
  setPromptSource('manual');
  files.forEach(im => URL.revokeObjectURL(im.url));
  files = [];
  renderPreviews();
}

async function doSubmit() {
  if (busy || !modal) return;
  const prompt = $('#subPrompt', modal).value.trim();
  if (!files.length) { showErr('请至少添加 1 张例图'); return; }
  if (!prompt) { showErr('请填写 prompt'); return; }
  const fd = new FormData();
  fd.append('title', $('#subTitle', modal).value.trim());
  fd.append('prompt', prompt);
  fd.append('negative', $('#subNegative', modal).value.trim());
  fd.append('comment', $('#subComment', modal).value.trim());
  fd.append('category', $('#subCategory', modal).value);
  fd.append('tags', $('#subTags', modal).value.trim());
  fd.append('submitter', $('#subName', modal).value.trim());
  fd.append('nsfw', $('#subNsfw', modal).checked ? '1' : '0');
  files.forEach((im, i) => {
    fd.append('images', im.blob, `${i + 1}.jpg`);
  });

  busy = true;
  const btn = $('#subGo', modal);
  btn.disabled = true;
  btn.textContent = '上传中…';
  showErr('');
  try {
    const r = await fetch('/api/submit', { method: 'POST', body: fd });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      resetForm();
      closeModal();
      toast('投稿成功，审核通过后会进入展廊');
    } else {
      showErr(data.error || `提交失败（HTTP ${r.status}）`);
    }
  } catch {
    showErr('网络错误，请稍后重试');
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = '提交投稿';
  }
}

const openBtn = document.getElementById('submitOpenBtn');
if (openBtn) openBtn.onclick = openModal;

})();
