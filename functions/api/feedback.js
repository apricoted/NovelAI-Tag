'use strict';

import { json, err, LIMITS, cleanLine, cleanText, readJson, listAll } from '../_lib.js';

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
    notification: env.SERVERCHAN_KEY
      ? { provider: 'serverchan', status: 'pending' }
      : { provider: 'serverchan', status: 'skipped', message: 'SERVERCHAN_KEY 未配置' },
  };

  await env.STRINGS_BUCKET.put(key, JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  if (env.SERVERCHAN_KEY) {
    context.waitUntil(deliverServerChanNotification(env.STRINGS_BUCKET, key, env.SERVERCHAN_KEY, record));
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

async function deliverServerChanNotification(bucket, recordKey, serverChanKey, record) {
  const attemptedAt = new Date().toISOString();
  try {
    const result = await pushServerChan(serverChanKey, record);
    record.notification = {
      provider: 'serverchan',
      status: 'sent',
      attemptedAt,
      completedAt: new Date().toISOString(),
      httpStatus: result.httpStatus,
      code: result.code,
      message: result.message,
    };
    console.log(JSON.stringify({
      event: 'feedback_serverchan_sent',
      feedbackId: record.id,
      httpStatus: result.httpStatus,
      code: result.code,
    }));
  } catch (ex) {
    const failure = normalizeServerChanFailure(ex);
    record.notification = {
      provider: 'serverchan',
      status: 'failed',
      attemptedAt,
      completedAt: new Date().toISOString(),
      httpStatus: failure.httpStatus,
      code: failure.code,
      message: failure.message,
    };
    console.warn(JSON.stringify({
      event: 'feedback_serverchan_failed',
      feedbackId: record.id,
      httpStatus: failure.httpStatus,
      code: failure.code,
      message: failure.message,
    }));
  }

  try {
    const currentKey = await findFeedbackRecordKey(bucket, record.id, recordKey);
    if (!currentKey) {
      console.log(JSON.stringify({
        event: 'feedback_notification_status_skipped',
        feedbackId: record.id,
        reason: 'record_no_longer_exists',
      }));
      return;
    }
    const currentRecord = await readJson(bucket, currentKey);
    if (!currentRecord) return;
    await bucket.put(currentKey, JSON.stringify({
      ...currentRecord,
      notification: record.notification,
    }), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
  } catch (ex) {
    console.error(JSON.stringify({
      event: 'feedback_notification_status_write_failed',
      feedbackId: record.id,
      message: cleanLine(ex?.message || ex, 300),
    }));
  }
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
  form.set('text', title);
  form.set('desp', lines.join('\n\n'));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(String(key).trim())}.send`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const raw = await readLimitedText(response, 4000);
  let payload = {};
  try { payload = JSON.parse(raw); } catch {}
  const code = Number.isFinite(Number(payload?.code)) ? Number(payload.code) : null;
  const message = cleanLine(payload?.message || payload?.msg || raw || response.statusText, 300);
  if (!response.ok || (code !== null && code !== 0)) {
    const error = new Error(message || `ServerChan HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.serverChanCode = code;
    throw error;
  }
  return {
    httpStatus: response.status,
    code,
    message: message || '发送成功',
  };
}

async function readLimitedText(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const take = Math.min(value.byteLength, maxBytes - total);
      chunks.push(value.slice(0, take));
      total += take;
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function normalizeServerChanFailure(ex) {
  return {
    httpStatus: Number(ex?.httpStatus || 0),
    code: ex?.serverChanCode != null && Number.isFinite(Number(ex.serverChanCode))
      ? Number(ex.serverChanCode)
      : null,
    message: cleanLine(ex?.message || ex || 'ServerChan 推送失败', 300),
  };
}

async function findFeedbackRecordKey(bucket, id, preferredKey) {
  if (preferredKey && await bucket.head(preferredKey)) return preferredKey;
  for (const status of ['pending', 'resolved', 'ignored']) {
    const keys = await listAll(bucket, `feedback/${status}/`);
    const found = keys.find(key => key.endsWith(`/${id}.json`) || key.endsWith(`${id}.json`));
    if (found) return found;
  }
  return '';
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
