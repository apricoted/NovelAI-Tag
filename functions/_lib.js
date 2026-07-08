'use strict';

// 投稿字段上限（前后端一致）
export const LIMITS = {
  title: 60,
  prompt: 2000,
  negative: 2000,
  comment: 500,
  submitter: 20,
  category: 60,
  tagLen: 30,
  tagCount: 8,
  imageCount: 6,
  imageBytes: 3 * 1024 * 1024,
  totalBytes: 15 * 1024 * 1024,
  pendingMax: 300,
};

export const IMAGE_LABELS = ['gallery', 'face', 'scene', 'nsfw'];
export const COMMUNITY_CATEGORIES = ['画风', '人物', '动作', '构图', '随手分享'];
export const DEFAULT_COMMUNITY_CATEGORY = '随手分享';

const CATEGORY_ALIASES = new Map([
  ['画风', '画风'],
  ['style', '画风'],
  ['人物', '人物'],
  ['面部', '人物'],
  ['角色', '人物'],
  ['face', '人物'],
  ['动作', '动作'],
  ['pose', '动作'],
  ['构图', '构图'],
  ['场景', '构图'],
  ['scene', '构图'],
  ['composition', '构图'],
  ['随手分享', '随手分享'],
  ['gallery', '随手分享'],
  ['其他', '随手分享'],
]);

const ABS_URL_RE = /^(?:https?:)?\/\//i;
const HOST_PATH_RE = /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/|$)/i;

// 社区专用 R2 桶的公开访问地址，来自 Pages 环境变量 STRINGS_PUBLIC_BASE
// （线上=新桶的 https://pub-….r2.dev 地址；本地 wrangler dev 在 .dev.vars 设为 /r2，经 functions/r2/ 代理读本地模拟桶）
export function publicBase(env) {
  const raw = String(env.STRINGS_PUBLIC_BASE || '').trim().replace(/\/+$/, '');
  if (!raw || raw.startsWith('/') || /^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  return 'https://' + raw;
}

// 存储相关配置齐全则返回 null，否则返回应直接回给客户端的错误 Response
export function requireStorage(env) {
  if (!env.STRINGS_BUCKET) return err('服务端未绑定存储桶 STRINGS_BUCKET（见配置指南第 3 步）', 503);
  if (!publicBase(env)) return err('服务端未配置 STRINGS_PUBLIC_BASE（新存储桶的公开地址，见配置指南第 4 步）', 503);
  return null;
}

export function imageUrl(env, key) {
  return publicBase(env) + '/' + String(key).split('/').map(encodeURIComponent).join('/');
}

export function normalizeImageFile(file) {
  const s = String(file == null ? '' : file).trim();
  if (!s || ABS_URL_RE.test(s) || s.startsWith('/') || s.startsWith('data:')) return s;
  if (HOST_PATH_RE.test(s)) return 'https://' + s;
  return s;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function err(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

// 管理接口口令校验；通过返回 null，失败返回应直接回给客户端的 Response
export function requireAdmin(context) {
  const token = String(context.env.ADMIN_TOKEN || '').trim();
  if (!token) return err('服务端未配置 ADMIN_TOKEN（见配置指南）', 503);
  const auth = context.request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1].trim() !== token) return err('管理口令错误或未提供', 401);
  return null;
}

export function validId(id) {
  return /^[0-9a-fA-F-]{8,40}$/.test(id);
}

/* ---- 字段清洗（投稿与审核编辑共用） ---- */
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanLine(v, max) {
  return String(v == null ? '' : v).replace(CTRL_RE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanText(v, max) {
  return String(v == null ? '' : v).replace(CTRL_RE, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

export function normTags(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,，]/);
  const out = [];
  for (const t of arr) {
    const s = cleanLine(t, LIMITS.tagLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= LIMITS.tagCount) break;
  }
  return out;
}

export function normCategoryName(v) {
  const s = cleanLine(v, LIMITS.category);
  if (!s) return DEFAULT_COMMUNITY_CATEGORY;
  if (COMMUNITY_CATEGORIES.includes(s)) return s;
  const key = s.toLowerCase().replace(/\s+/g, '');
  return CATEGORY_ALIASES.get(key) || DEFAULT_COMMUNITY_CATEGORY;
}

export function normCategory(v) {
  const raw = Array.isArray(v) ? v[0] : String(v == null ? '' : v).split('/')[0];
  return [normCategoryName(raw)];
}

export function communityCategoriesFromEntries(entries) {
  const used = new Set((entries || []).map(e => normCategory(e && e.category)[0]));
  return COMMUNITY_CATEGORIES.filter(c => used.has(c));
}

export function defaultSubmissionTitle({ title, category, prompt } = {}) {
  const given = cleanLine(title, LIMITS.title);
  if (given) return given;
  if (category != null && (!Array.isArray(category) || category.length)) {
    const cat = normCategoryName(Array.isArray(category) ? category[0] : category);
    return cat.endsWith('分享') ? cat : `${cat}分享`;
  }
  const promptHead = cleanLine(String(prompt || '').replace(/[{}[\](),，]+/g, ' '), 18);
  return promptHead || DEFAULT_COMMUNITY_CATEGORY;
}

/* ---- R2 辅助 ---- */
export async function readJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try { return await obj.json(); } catch { return null; }
}

export async function listAll(bucket, prefix) {
  const keys = [];
  let cursor;
  do {
    const res = await bucket.list({ prefix, cursor });
    for (const o of res.objects) keys.push(o.key);
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return keys;
}

export async function readJsonBatch(bucket, keys) {
  const out = [];
  const BATCH = 20;
  for (let i = 0; i < keys.length; i += BATCH) {
    const part = await Promise.all(keys.slice(i, i + BATCH).map(k => readJson(bucket, k)));
    for (const r of part) if (r) out.push(r);
  }
  return out;
}

export async function deleteImages(env, id) {
  const keys = await listAll(env.STRINGS_BUCKET, `community/img/${id}/`);
  if (keys.length) await env.STRINGS_BUCKET.delete(keys);
}

/* ---- 投稿记录 -> 前端 entry（图片转绝对 URL，结构对齐 strings.js） ---- */
export function toEntry(env, rec) {
  return {
    id: rec.id,
    title: rec.title || '',
    prompt: rec.prompt || '',
    negative: rec.negative || '',
    comment: rec.comment || '',
    tags: Array.isArray(rec.tags) ? rec.tags : [],
    category: normCategory(rec.category),
    nsfw: !!rec.nsfw,
    submitter: rec.submitter || '',
    createdAt: rec.createdAt || 0,
    images: (rec.images || []).map(im => ({
      file: imageUrl(env, im.key),
      label: IMAGE_LABELS.includes(im.label) ? im.label : 'gallery',
    })),
  };
}

export function emptyCollection() {
  return { title: '共创广场', author: '', categories: [], entries: [], imagedCount: 0 };
}

// 重新生成聚合发布文件 community/community.json（每次通过/下架后调用）
export async function rebuildCommunity(env) {
  const bucket = env.STRINGS_BUCKET;
  const keys = (await listAll(bucket, 'community/approved/')).filter(k => k.endsWith('.json'));
  const records = await readJsonBatch(bucket, keys);
  records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const entries = records.map(r => toEntry(env, r));
  const categories = communityCategoriesFromEntries(entries);
  const data = {
    ...emptyCollection(),
    categories,
    entries,
    imagedCount: entries.filter(e => e.images.length).length,
    generatedAt: Date.now(),
  };
  await bucket.put('community/community.json', JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return data;
}
