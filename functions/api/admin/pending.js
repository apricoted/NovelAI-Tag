'use strict';

import { json, err, requireAdmin, listAll, readJsonBatch, toEntry } from '../../_lib.js';

// GET /api/admin/pending — 待审投稿列表（需 Authorization: Bearer <ADMIN_TOKEN>）
export async function onRequestGet(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { env } = context;
  if (!env.STRINGS_BUCKET) return err('服务端未绑定存储桶 STRINGS_BUCKET（见配置指南）', 503);

  const keys = (await listAll(env.STRINGS_BUCKET, 'community/pending/')).filter(k => k.endsWith('.json'));
  const records = await readJsonBatch(env.STRINGS_BUCKET, keys);
  records.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); // 先来先审
  return json({ ok: true, items: records.map(r => toEntry(env, r)) });
}
