'use strict';

import { json, err, requireAdmin, validId, readJson, listAll, cleanLine } from '../../_lib.js';

const ACTIONS = new Set(['resolve', 'ignore']);

export async function onRequestPost(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { request, env } = context;
  if (!env.STRINGS_BUCKET) return err('服务端未绑定存储桶 STRINGS_BUCKET', 503);

  let body;
  try { body = await request.json(); } catch { return err('请求格式错误'); }
  const id = String(body?.id || '');
  const action = cleanLine(body?.action, 20);
  if (!validId(id)) return err('无效的反馈 id');
  if (!ACTIONS.has(action)) return err('未知反馈操作');

  const pendingKey = await findPendingFeedbackKey(env.STRINGS_BUCKET, id);
  if (!pendingKey) return err('该反馈不存在或已被处理', 404);
  const record = await readJson(env.STRINGS_BUCKET, pendingKey);
  if (!record) return err('该反馈内容读取失败', 404);

  const now = new Date();
  const nextStatus = action === 'resolve' ? 'resolved' : 'ignored';
  const nextKey = `feedback/${nextStatus}/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${id}.json`;
  const nextRecord = {
    ...record,
    status: nextStatus,
    handledAction: action,
    handledAt: now.getTime(),
    handledAtIso: now.toISOString(),
  };

  await env.STRINGS_BUCKET.put(nextKey, JSON.stringify(nextRecord), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await env.STRINGS_BUCKET.delete(pendingKey);
  return json({ ok: true, id, action, status: nextStatus });
}

async function findPendingFeedbackKey(bucket, id) {
  const keys = (await listAll(bucket, 'feedback/pending/'))
    .filter(k => k.endsWith(`/${id}.json`) || k.endsWith(`${id}.json`));
  return keys[0] || '';
}

function pad(n) {
  return String(n).padStart(2, '0');
}
