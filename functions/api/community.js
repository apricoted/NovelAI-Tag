'use strict';

import {
  json, emptyCollection, normalizeImageFile,
  normCategory, communityCategoriesFromEntries,
} from '../_lib.js';

function normalizeCommunityData(data) {
  const empty = emptyCollection();
  const base = data && typeof data === 'object' ? data : empty;
  const entries = Array.isArray(base.entries) ? base.entries.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;
    const images = Array.isArray(entry.images) ? entry.images.map(image => {
      if (typeof image === 'string') return normalizeImageFile(image);
      if (!image || typeof image !== 'object') return image;
      const out = { ...image, file: normalizeImageFile(image.file) };
      if (out.original) out.original = normalizeImageFile(out.original);
      return out;
    }) : [];
    return { ...entry, category: normCategory(entry.category), images };
  }) : [];
  return {
    ...empty,
    ...base,
    title: empty.title,
    entries,
    categories: communityCategoriesFromEntries(entries),
    imagedCount: entries.filter(e => e && Array.isArray(e.images) && e.images.length).length,
  };
}

// GET /api/community — 已发布的社区投稿列表（strings.js 的 dataUrl 指向这里）
export async function onRequestGet({ env }) {
  if (!env.STRINGS_BUCKET) return json(emptyCollection());
  const obj = await env.STRINGS_BUCKET.get('community/community.json');
  if (!obj) return json(emptyCollection());
  const data = await obj.json().catch(() => null);
  return json(normalizeCommunityData(data));
}
