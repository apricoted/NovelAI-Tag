'use strict';

import { json, err, requireAdmin, requireStorage, validId, findCommunityRecord, moveCommunityRecord } from '../../_lib.js';

// POST /api/admin/unpublish — 下架已发布的投稿：{id}
// 软下架到 community/hidden/，保留记录与图片，再重新生成发布文件
export async function onRequestPost(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { env } = context;
  const noStorage = requireStorage(env);
  if (noStorage) return noStorage;

  let body;
  try { body = await context.request.json(); } catch { return err('请求格式错误'); }
  const id = String(body.id || '');
  if (!validId(id)) return err('无效的投稿 id');

  const found = await findCommunityRecord(env, id, ['approved']);
  if (!found) return err('该投稿不在已发布列表', 404);

  await moveCommunityRecord(env, found, 'hidden', { now: Date.now() });
  return json({ ok: true, action: 'unpublish' });
}
