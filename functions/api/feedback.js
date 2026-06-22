'use strict';

import { json, err, LIMITS, cleanLine, cleanText, readJson } from '../_lib.js';

const TYPES = new Set(['site_bug', 'card_content', 'image_error', 'copy_error', 'suggestion']);
const LIMIT = {
  descriptionMin: 10,
  description: 1000,
  contact: 120,
  contextBytes: 12000,
  bodyBytes: 36000,
  perWindow: 5,
  windowMs: 10 * 60 * 1000,
};

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.STRINGS_BUCKET) return err('服务端未绑定存储桶 STRINGS_BUCKET', 503);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > LIMIT.bodyBytes) return err('反馈内容过大', 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return err('请求格式错误');
  }

  if (cleanLine(body?.honeypot, 200)) {
    return json({ ok: true, id: '' }, 201);
  }

  const type = cleanLine(body?.type, 40);
  if (!TYPES.has(type)) return err('反馈类型无效');

  const descriptionRaw = cleanText(body?.description, LIMIT.description + 1);
  if (descriptionRaw.length < LIMIT.descriptionMin) return err(`反馈内容至少 ${LIMIT.descriptionMin} 个字`);
  if (descriptionRaw.length > LIMIT.description) return err(`反馈内容最多 ${LIMIT.description} 个字`);
  const contactRaw = cleanLine(body?.contact, LIMIT.contact + 1);
  if (contactRaw.length > LIMIT.contact) return err(`联系方式最多 ${LIMIT.contact} 个字`);

  const ipHash = await hashIp(request, env);
  const limited = await applySoftRateLimit(env.STRINGS_BUCKET, ipHash);
  if (limited) return err('反馈太频繁，请稍后再试', 429);

  const pend = await env.STRINGS_BUCKET.list({ prefix: 'feedback/pending/', limit: 1000 });
  const pendCount = pend.objects.filter(o => o.key.endsWith('.json')).length;
  if (pendCount >= LIMITS.pendingMax) return err('反馈队列已满，请过几天再试', 429);

  const now = new Date();
  const id = crypto.randomUUID();
  const key = `feedback/pending/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${id}.json`;
  const record = {
    id,
    type,
    description: descriptionRaw,
    contact: contactRaw,
    context: normalizeContext(body?.context),
    receivedAt: now.toISOString(),
    createdAt: now.getTime(),
    commitSha: cleanLine(env.CF_PAGES_COMMIT_SHA, 80) || 'local',
    ipHash,
    cfRay: cleanLine(request.headers.get('cf-ray'), 120),
  };

  await env.STRINGS_BUCKET.put(key, JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  if (env.SERVERCHAN_KEY && context.waitUntil) {
    context.waitUntil(pushServerChan(env.SERVERCHAN_KEY, record).catch(ex => {
      console.warn('[feedback] ServerChan push failed', ex);
    }));
  }

  return json({ ok: true, id }, 201);
}

function normalizeContext(value) {
  const text = safeStringify(value || {});
  if (text.length <= LIMIT.contextBytes) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  return {
    truncated: true,
    raw: text.slice(0, LIMIT.contextBytes),
  };
}

async function applySoftRateLimit(bucket, ipHash) {
  const windowId = Math.floor(Date.now() / LIMIT.windowMs);
  const key = `feedback/ratelimit/${ipHash}/${windowId}.json`;
  const current = await readJson(bucket, key);
  const count = Number(current?.count || 0);
  if (count >= LIMIT.perWindow) return true;
  await bucket.put(key, JSON.stringify({
    count: count + 1,
    firstAt: current?.firstAt || Date.now(),
    updatedAt: Date.now(),
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return false;
}

async function hashIp(request, env) {
  const raw = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || 'unknown';
  const salt = String(env.RATE_LIMIT_SALT || env.ADMIN_TOKEN || 'novelai-tag-feedback').slice(0, 128);
  const bytes = new TextEncoder().encode(`${salt}:${raw}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function pushServerChan(key, record) {
  const title = `法典图鉴反馈：${record.type}`;
  const lines = [
    `类型：${record.type}`,
    `时间：${record.receivedAt}`,
    `描述：${record.description}`,
    record.contact ? `联系方式：${record.contact}` : '',
    record.context?.page?.url ? `页面：${record.context.page.url}` : '',
    record.context?.entry?.title ? `词条：${record.context.entry.title}` : '',
  ].filter(Boolean);
  const form = new URLSearchParams();
  form.set('title', title);
  form.set('desp', lines.join('\n\n'));
  await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(String(key))}.send`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: form.toString(),
  });
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}
