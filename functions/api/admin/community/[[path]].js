'use strict';

import {
  json, err, requireAdmin, requireStorage, validId, cleanLine,
  COMMUNITY_STATUSES, DEFAULT_COMMUNITY_STATUS,
  listAll, readJsonBatch, toAdminEntry, findCommunityRecord, writeCommunityRecord,
  moveCommunityRecord, applyCommunityEdits, rebuildCommunity, deleteImages,
} from '../../../_lib.js';

const MUTATIONS = new Set([
  'update', 'approve', 'reject', 'publish', 'unpublish',
  'delete', 'restore', 'purge', 'batch', 'moveCategory', 'updateCategory',
]);

export async function onRequestGet(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const noStorage = requireStorage(context.env);
  if (noStorage) return noStorage;

  const route = routeName(context);
  if (route === 'stats') return getStats(context.env);
  if (route) return err('未知管理接口', 404);

  const url = new URL(context.request.url);
  const status = statusParam(url.searchParams.get('status'), DEFAULT_COMMUNITY_STATUS);
  if (!status) return err('内容状态无效');
  const items = await listCommunityItems(context.env, status);
  return json({ ok: true, status, items });
}

export async function onRequestPost(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const noStorage = requireStorage(context.env);
  if (noStorage) return noStorage;

  let body;
  try { body = await context.request.json(); } catch { return err('请求格式错误'); }
  const route = routeName(context) || cleanLine(body && body.action, 40);
  if (!MUTATIONS.has(route)) return err('未知管理操作', 404);

  try {
    const data = await mutate(context.env, route, body || {});
    return json({ ok: true, ...data });
  } catch (e) {
    return err(e.message || '操作失败', e.status || 400);
  }
}

async function listCommunityItems(env, status) {
  const keys = (await listAll(env.STRINGS_BUCKET, `community/${status}/`))
    .filter(k => k.endsWith('.json'));
  const records = await readJsonBatch(env.STRINGS_BUCKET, keys);
  return records
    .filter(Boolean)
    .map(r => toAdminEntry(env, r, status))
    .sort((a, b) => sortTime(status, a) - sortTime(status, b));
}

async function getStats(env) {
  const counts = {};
  const categories = {};
  let nsfw = 0;
  let images = 0;
  let total = 0;
  for (const status of COMMUNITY_STATUSES) {
    const items = await listCommunityItems(env, status);
    counts[status] = items.length;
    total += items.length;
    for (const item of items) {
      images += (item.images || []).length;
      if (item.nsfw) nsfw += 1;
      const cat = (item.category || [])[0] || '随手分享';
      categories[cat] = (categories[cat] || 0) + 1;
    }
  }
  return json({ ok: true, counts, categories, nsfw, images, total, generatedAt: Date.now() });
}

async function mutate(env, action, body) {
  if (action === 'batch') return batchMutate(env, body);
  if (action === 'moveCategory' || action === 'updateCategory') {
    const category = body.category != null ? body.category : body.edits && body.edits.category;
    return updateItem(env, { ...body, edits: { ...(body.edits || {}), category } });
  }
  if (action === 'update') return updateItem(env, body);
  if (action === 'approve') return approveItem(env, body);
  if (action === 'reject') return rejectItem(env, body);
  if (action === 'publish') return publishItem(env, body);
  if (action === 'unpublish') return unpublishItem(env, body);
  if (action === 'delete') return deleteItem(env, body);
  if (action === 'restore') return restoreItem(env, body);
  if (action === 'purge') return purgeItem(env, body);
  throw httpError('未知管理操作', 404);
}

async function updateItem(env, body) {
  const found = await requireItem(env, body.id, statusSearch(body.status));
  const result = applyCommunityEdits(found.record, body.edits || {});
  if (result.error) throw httpError(result.error);
  result.record.status = found.status;
  const saved = await writeCommunityRecord(env, found.status, result.record);
  if (found.status === 'approved') await rebuildCommunity(env);
  return { action: 'update', item: toAdminEntry(env, saved, found.status) };
}

async function approveItem(env, body) {
  const found = await requireItem(env, body.id, ['pending']);
  const result = applyCommunityEdits(found.record, body.edits || {});
  if (result.error) throw httpError(result.error);
  const now = Date.now();
  const record = await moveCommunityRecord(env, found, 'approved', {
    now,
    fields: { ...result.record, reviewedAt: now, publishedAt: now, hiddenAt: 0, deletedAt: 0 },
  });
  return { action: 'approve', item: toAdminEntry(env, record, 'approved') };
}

async function rejectItem(env, body) {
  const found = await requireItem(env, body.id, ['pending']);
  const now = Date.now();
  const record = await moveCommunityRecord(env, found, 'rejected', {
    now,
    fields: { adminNote: cleanLine(body.reason || body.adminNote, 200) || found.record.adminNote },
  });
  return { action: 'reject', item: toAdminEntry(env, record, 'rejected') };
}

async function publishItem(env, body) {
  const found = await requireItem(env, body.id, statusSearch(body.status, ['hidden', 'deleted', 'rejected', 'pending']));
  if (found.status === 'pending') return approveItem(env, body);
  const result = body.edits ? applyCommunityEdits(found.record, body.edits) : { record: found.record };
  if (result.error) throw httpError(result.error);
  const now = Date.now();
  const record = await moveCommunityRecord(env, { ...found, record: result.record }, 'approved', {
    now,
    fields: { hiddenAt: 0, deletedAt: 0, publishedAt: now },
  });
  return { action: 'publish', item: toAdminEntry(env, record, 'approved') };
}

async function unpublishItem(env, body) {
  const found = await requireItem(env, body.id, ['approved']);
  const now = Date.now();
  const record = await moveCommunityRecord(env, found, 'hidden', {
    now,
    fields: { hiddenAt: now, adminNote: cleanLine(body.reason || body.adminNote, 200) || found.record.adminNote },
  });
  return { action: 'unpublish', item: toAdminEntry(env, record, 'hidden') };
}

async function deleteItem(env, body) {
  const found = await requireItem(env, body.id, statusSearch(body.status, ['pending', 'approved', 'hidden', 'rejected']));
  const now = Date.now();
  const record = await moveCommunityRecord(env, found, 'deleted', {
    now,
    fields: { deletedAt: now, previousStatus: found.status },
  });
  return { action: 'delete', item: toAdminEntry(env, record, 'deleted') };
}

async function restoreItem(env, body) {
  const found = await requireItem(env, body.id, ['deleted']);
  const target = statusParam(body.targetStatus || body.toStatus, 'hidden');
  if (!target || target === 'deleted' || target === 'pending') throw httpError('恢复目标状态无效');
  const now = Date.now();
  const record = await moveCommunityRecord(env, found, target, {
    now,
    fields: { deletedAt: 0, hiddenAt: target === 'hidden' ? now : 0 },
  });
  return { action: 'restore', status: target, item: toAdminEntry(env, record, target) };
}

async function purgeItem(env, body) {
  const found = await requireItem(env, body.id, statusSearch(body.status));
  await deleteImages(env, found.record.id);
  await env.STRINGS_BUCKET.delete(found.key);
  if (found.status === 'approved') await rebuildCommunity(env);
  return { action: 'purge', id: found.record.id, status: found.status };
}

async function batchMutate(env, body) {
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(validId).slice(0, 100) : [];
  const action = cleanLine(body.action, 40);
  if (!ids.length) throw httpError('请选择要操作的内容');
  if (!action || action === 'batch' || !MUTATIONS.has(action)) throw httpError('批量操作无效');
  const errors = [];
  let changed = 0;
  for (const id of ids) {
    try {
      await mutate(env, action, { ...body, id, ids: undefined });
      changed += 1;
    } catch (e) {
      errors.push({ id, error: e.message || '操作失败' });
    }
  }
  return { action: 'batch', batchAction: action, changed, errors };
}

async function requireItem(env, id, statuses = COMMUNITY_STATUSES) {
  const itemId = String(id || '');
  if (!validId(itemId)) throw httpError('无效的内容 id');
  const found = await findCommunityRecord(env, itemId, statuses);
  if (!found) throw httpError('该内容不存在或状态不匹配', 404);
  return found;
}

function statusSearch(status, fallback = COMMUNITY_STATUSES) {
  if (status == null || status === '') return fallback;
  const s = statusParam(status, '');
  if (!s) throw httpError('内容状态无效');
  return [s];
}

function statusParam(value, fallback) {
  const raw = cleanLine(value, 20);
  if (!raw) return fallback;
  return COMMUNITY_STATUSES.includes(raw) ? raw : '';
}

function sortTime(status, a) {
  if (status === 'pending') return Number(a.createdAt || 0);
  return -Number(a.updatedAt || a.publishedAt || a.hiddenAt || a.deletedAt || a.createdAt || 0);
}

function routeName(context) {
  const raw = context.params && context.params.path;
  const parts = Array.isArray(raw) ? raw : (raw == null ? [] : String(raw).split('/'));
  return parts.filter(Boolean).join('/').replace(/^\/+|\/+$/g, '');
}

function httpError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}
