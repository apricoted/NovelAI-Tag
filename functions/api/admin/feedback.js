'use strict';

import { json, err, requireAdmin, listAll, readJsonBatch, cleanLine } from '../../_lib.js';

const STATUSES = new Set(['pending', 'resolved', 'ignored']);
const TYPE_LABELS = {
  site_bug: '站点 Bug / 使用问题',
  card_content: '卡片内容错误',
  image_error: '图片加载 / 配图问题',
  copy_error: '复制结果问题',
  suggestion: '建议 / 想法',
};

export async function onRequestGet(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { request, env } = context;
  if (!env.STRINGS_BUCKET) return err('服务端未绑定存储桶 STRINGS_BUCKET', 503);

  const url = new URL(request.url);
  const status = cleanLine(url.searchParams.get('status'), 20) || 'pending';
  if (!STATUSES.has(status)) return err('反馈状态无效');

  const keys = (await listAll(env.STRINGS_BUCKET, `feedback/${status}/`))
    .filter(k => k.endsWith('.json'));
  const records = await readJsonBatch(env.STRINGS_BUCKET, keys);
  const items = records
    .filter(Boolean)
    .map(r => sanitizeFeedbackRecord(r, status))
    .sort((a, b) => sortTime(b) - sortTime(a))
    .slice(0, 200);

  return json({ ok: true, status, items });
}

function sortTime(item) {
  return Number(item.handledAt || item.createdAt || 0);
}

function sanitizeFeedbackRecord(record, status) {
  const type = String(record.type || 'site_bug');
  const context = record.context || {};
  return {
    id: String(record.id || ''),
    status: String(record.status || status),
    type,
    typeLabel: TYPE_LABELS[type] || type,
    description: String(record.description || ''),
    contact: String(record.contact || ''),
    context,
    createdAt: Number(record.createdAt || Date.parse(record.receivedAt) || 0),
    receivedAt: String(record.receivedAt || ''),
    handledAt: Number(record.handledAt || 0),
    handledAction: String(record.handledAction || ''),
    commitSha: String(record.commitSha || ''),
    cfRay: String(record.cfRay || ''),
    notification: sanitizeNotification(record.notification),
  };
}

function sanitizeNotification(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    provider: String(value.provider || ''),
    status: String(value.status || ''),
    attemptedAt: String(value.attemptedAt || ''),
    completedAt: String(value.completedAt || ''),
    httpStatus: Number(value.httpStatus || 0),
    code: value.code == null ? null : Number(value.code),
    message: String(value.message || ''),
  };
}
