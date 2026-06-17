'use strict';

const $ = (s, r = document) => r.querySelector(s);

const VIRTUAL_BUFFER_UP = 0.8;
const VIRTUAL_BUFFER_DOWN = 1.4;
const IMAGE_LOAD_DELAY = 90;
const RELAYOUT_INTERVAL = 150;
const RELAYOUT_ANIM_MS = 320;
const DEFAULT_IMAGE_RATIO = 1.18;
const RANDOM_RECENT_LIMIT = 20;
const DENSITY_STORAGE_KEY = 'fadian-density';
const DEFAULT_DENSITY = 'standard';
const RECENT_STORAGE_KEY = 'fadian-recent';
const LAST_BROWSE_STORAGE_KEY = 'fadian-last-browse';
const RECENT_ENTRY_LIMIT = 18;
const DENSITY_PRESETS = {
  comfort: {
    label: '舒适',
    minWidth: 340,
    gap: 18,
    bodyPadX: 14,
    bodyPadTop: 13,
    bodyPadBottom: 12,
    titleCharWidth: 14,
    titleLineHeight: 21,
    titleGap: 9,
    tagCharWidth: 7.2,
    tagLineHeight: 20,
    tagPaddingY: 20,
    minTagHeight: 40,
    maxTagHeight: 136,
    maxTagLines: 7,
    footGap: 10,
    footHeight: 18,
    footHeightNegative: 21,
  },
  standard: {
    label: '标准',
    minWidth: 290,
    gap: 16,
    bodyPadX: 13,
    bodyPadTop: 12,
    bodyPadBottom: 11,
    titleCharWidth: 14,
    titleLineHeight: 20,
    titleGap: 8,
    tagCharWidth: 7,
    tagLineHeight: 19,
    tagPaddingY: 18,
    minTagHeight: 34,
    maxTagHeight: 114,
    maxTagLines: 6,
    footGap: 9,
    footHeight: 18,
    footHeightNegative: 21,
  },
  compact: {
    label: '紧凑',
    minWidth: 236,
    gap: 12,
    bodyPadX: 11,
    bodyPadTop: 10,
    bodyPadBottom: 10,
    titleCharWidth: 13.5,
    titleLineHeight: 19,
    titleGap: 7,
    tagCharWidth: 6.8,
    tagLineHeight: 17.5,
    tagPaddingY: 16,
    minTagHeight: 30,
    maxTagHeight: 86,
    maxTagLines: 4,
    footGap: 7,
    footHeight: 17,
    footHeightNegative: 20,
  },
};
const NSFW_STORAGE_KEY = 'fadian-nsfw-ok';
const NSFW_LOCKED_MESSAGE = '请先在设置里开启「允许 NSFW 法典展示」，并确认成人内容提示。';

const state = {
  codex: null,        // 当前法典数据
  codexes: [],
  codexCache: new Map(),
  list: [],           // 当前过滤后的词条
  rendered: 0,        // 当前虚拟渲染数量
  placements: [],     // 虚拟瀑布流布局
  nodes: new Map(),   // index -> DOM node
  colN: 0,
  itemWidth: 0,
  activePath: [],     // 选中的目录路径
  query: '',
  searchPlan: null,
  onlyImaged: false,
  onlyFav: false,
  allowNsfw: false,
  sdMode: false,      // 复制时把 NAI 权重转成 Stable Diffusion 格式
  density: DEFAULT_DENSITY,
  favs: new Set(),    // 收藏集合，键为 codexId:entryId
  loadedImages: new Set(),
  seenAnimated: new Set(),
  recentRandomIds: [],
  recentEntries: [],
  lastBrowse: null,
  sourceNoticesShown: new Set(),
  pendingUrlState: null,
  suppressUrlSync: false,
  lightbox: {
    entry: null,
    images: [],
    index: 0,
  },
  media: {
    baseUrl: '',
    imagePrefix: 'images',
    originalPrefix: 'originals',
    localFallback: true,
  },
};

const THEME_ICONS = {
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
};

/* ---------------- 数据加载 ---------------- */
async function init() {
  try {
    setLoading('正在加载法典索引…');
    const savedFavs = safeJsonParse(localStorage.getItem('fadian-favs'), []);
    state.favs = new Set(Array.isArray(savedFavs) ? savedFavs : []);
    state.recentEntries = normalizeRecentEntries(safeJsonParse(localStorage.getItem(RECENT_STORAGE_KEY), []));
    state.lastBrowse = normalizeLastBrowse(safeJsonParse(localStorage.getItem(LAST_BROWSE_STORAGE_KEY), null));
    state.allowNsfw = localStorage.getItem(NSFW_STORAGE_KEY) === '1';
    document.body.classList.toggle('nsfw-unlocked', state.allowNsfw);
    applyDensity(localStorage.getItem(DENSITY_STORAGE_KEY), { render: false });
    const [codexes, media, about] = await Promise.all([
      fetch('data/codexes.json', { cache: 'no-store' }).then(r => r.json()),
      loadMedia(),
      loadAbout(),
    ]);
    state.codexes = codexes;
    state.media = { ...state.media, ...media };
    state.about = about;
    const sel = $('#codexSelect');
    sel.innerHTML = codexes.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('');
    sel.onchange = () => loadCodex(sel.value);
    setupCodexPicker();
    setupAbout();
    bindUI();
    state.pendingUrlState = readUrlState();
    const initialMeta = state.codexes.find(c => c.id === state.pendingUrlState.codex);
    const initialId = initialMeta && !isCodexLocked(initialMeta)
      ? state.pendingUrlState.codex
      : firstUnlockedCodex()?.id || codexes[0]?.id;
    if (initialMeta && isCodexLocked(initialMeta)) showNsfwLockedHint();
    if (codexes.length) await loadCodex(initialId, { urlState: state.pendingUrlState, replaceUrl: true });
    else setLoading('还没有可显示的法典数据');
  } catch (ex) {
    console.error(ex);
    setLoading('加载失败，请刷新页面重试');
  }
}

function isNsfwCodex(c) {
  return Boolean(c?.nsfw);
}

function isCodexLocked(c) {
  return isNsfwCodex(c) && !state.allowNsfw;
}

function firstUnlockedCodex() {
  return state.codexes.find(c => !isCodexLocked(c));
}

function showNsfwLockedHint() {
  toast(NSFW_LOCKED_MESSAGE, '!');
}

/* 自绘法典下拉菜单（原生 select 隐藏，仅作值同步） */
function setupCodexPicker() {
  const sel = $('#codexSelect');
  const btn = $('#codexBtn');
  const menu = $('#codexMenu');
  if (!btn || !menu) return;
  const items = () => [...menu.querySelectorAll('.codex-item')];
  const activeIndex = () => Math.max(0, items().findIndex(item => item.classList.contains('active')));
  const focusItem = index => {
    const list = items();
    if (!list.length) return;
    list[(index + list.length) % list.length].focus();
  };
  const open = ({ focus = false, index = activeIndex() } = {}) => {
    menu.hidden = false;
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    if (focus) requestAnimationFrame(() => focusItem(index));
  };
  const close = ({ focusButton = false } = {}) => {
    menu.hidden = true;
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    if (focusButton) btn.focus();
  };
  const choose = item => {
    if (!item) return;
    if (item.getAttribute('aria-disabled') === 'true') {
      showNsfwLockedHint();
      return;
    }
    close({ focusButton: true });
    if (sel.value !== item.dataset.id) {
      sel.value = item.dataset.id;
      loadCodex(item.dataset.id);
    }
  };
  menu.innerHTML = '';
  state.codexes.forEach((c, i) => {
    const pct = c.entryCount ? Math.round((Number(c.imagedCount || 0) / Number(c.entryCount || 1)) * 100) : 0;
    const locked = isCodexLocked(c);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `codex-item${locked ? ' locked' : ''}`;
    item.dataset.id = c.id;
    item.id = `codexOption-${i}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.setAttribute('aria-disabled', locked ? 'true' : 'false');
    if (locked) item.title = NSFW_LOCKED_MESSAGE;
    item.tabIndex = -1;
    item.innerHTML =
      `<span class="ci-mark">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="ci-main">` +
      `<span class="ci-name">${esc(c.title)}</span>` +
      `<span class="ci-meta">${esc(c.author || '未知作者')} · ${Number(c.entryCount || 0)} 条 · ${pct}% 配图 · ${esc(codexStatusLabel(c))}</span>` +
      `<span class="ci-bar"><i style="width:${pct}%"></i></span>` +
      `<span class="ci-lock"${locked ? '' : ' hidden'}>需设置解锁</span>` +
      `</span>` +
      '<svg class="ck" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>';
    item.onclick = () => choose(item);
    menu.appendChild(item);
  });
  btn.onclick = ev => {
    ev.stopPropagation();
    if (menu.hidden) open({ focus: true });
    else close();
  };
  btn.onkeydown = ev => {
    const list = items();
    if (!list.length) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (menu.hidden) open({ focus: true });
      else close();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      open({ focus: true, index: menu.hidden ? activeIndex() : activeIndex() + 1 });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      open({ focus: true, index: menu.hidden ? activeIndex() : activeIndex() - 1 });
    }
  };
  menu.onkeydown = ev => {
    const list = items();
    const current = list.indexOf(document.activeElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close({ focusButton: true });
    } else if (ev.key === 'Tab') {
      close();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      focusItem(current + 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      focusItem(current - 1);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      focusItem(0);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      focusItem(list.length - 1);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      choose(document.activeElement.closest('.codex-item'));
    }
  };
  document.addEventListener('click', ev => {
    if (!menu.hidden && !menu.contains(ev.target) && !btn.contains(ev.target)) close();
  });
  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !menu.hidden) close({ focusButton: true });
  });
  updateCodexPickerState();
}

function updateCodexPickerState() {
  document.querySelectorAll('#codexMenu .codex-item').forEach(it => {
    const c = state.codexes.find(item => item.id === it.dataset.id);
    const locked = isCodexLocked(c);
    const active = state.codex?.id === c?.id;
    it.classList.toggle('locked', locked);
    it.classList.toggle('active', active);
    it.setAttribute('aria-disabled', locked ? 'true' : 'false');
    it.setAttribute('aria-selected', active ? 'true' : 'false');
    if (locked) it.title = NSFW_LOCKED_MESSAGE;
    else it.removeAttribute('title');
    const lock = it.querySelector('.ci-lock');
    if (lock) lock.hidden = !locked;
  });
}

async function loadMedia() {
  try {
    const res = await fetch('data/media.json', { cache: 'no-store' });
    if (res.ok) return res.json();
  } catch {}
  return {};
}

async function loadAbout() {
  try {
    const res = await fetch('data/about.json', { cache: 'no-store' });
    if (res.ok) return res.json();
  } catch {}
  return { links: [], tips: [], credits: [] };
}

function safeJsonParse(raw, fallback) {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeRecentEntries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && item.codexId && item.entryId && item.title)
    .map(item => ({
      codexId: String(item.codexId),
      codexTitle: String(item.codexTitle || item.codexId),
      entryId: String(item.entryId),
      title: String(item.title),
      path: Array.isArray(item.path) ? item.path.map(String) : [],
      thumb: String(item.thumb || ''),
      at: Number(item.at) || Date.now(),
    }))
    .slice(0, RECENT_ENTRY_LIMIT);
}

function normalizeLastBrowse(value) {
  if (!value || typeof value !== 'object' || !value.codexId) return null;
  return {
    codexId: String(value.codexId),
    codexTitle: String(value.codexTitle || value.codexId),
    path: Array.isArray(value.path) ? value.path.map(String) : [],
    q: String(value.q || ''),
    onlyImaged: Boolean(value.onlyImaged),
    onlyFav: Boolean(value.onlyFav),
    entryId: String(value.entryId || ''),
    scrollY: Math.max(0, Number(value.scrollY) || 0),
    at: Number(value.at) || Date.now(),
  };
}

let codexLoadSeq = 0;
async function loadCodex(id, options = {}) {
  const meta = state.codexes.find(c => c.id === id) || { id };
  if (isCodexLocked(meta)) {
    showNsfwLockedHint();
    const fallback = firstUnlockedCodex();
    if (fallback && fallback.id !== id) {
      return loadCodex(fallback.id, { ...options, urlState: null, replaceUrl: true });
    }
    setLoading('需要在设置中开启 NSFW 法典展示后才能查看');
    return;
  }
  const seq = ++codexLoadSeq;
  setLoading('正在加载词条数据…');
  clearMasonry();
  const codex = await fetchCodex(meta);
  if (seq !== codexLoadSeq) return;
  state.codex = codex;
  const c = state.codex;
  const codexSelect = $('#codexSelect');
  if (codexSelect) codexSelect.value = c.id;
  $('#codexTitle').textContent = c.title;
  $('#codexMeta').textContent = `${c.author ? c.author + ' · ' : ''}${c.version} · ${c.entryCount} 条`;
  const codexBtnText = $('#codexBtnText');
  if (codexBtnText) codexBtnText.textContent = c.title;
  updateCodexPickerState();
  const urlState = options.urlState && (!options.urlState.codex || options.urlState.codex === c.id)
    ? options.urlState
    : null;
  state.activePath = urlState?.path?.length ? urlState.path : [];
  state.query = urlState?.q || '';
  state.seenAnimated.clear();
  state.recentRandomIds = [];
  $('#search').value = state.query;
  updateSearchClear();
  renderTree();
  renderCodexHeader();
  applyFilter({ resetScroll: true });
  syncUrlState({ replace: options.replaceUrl !== false, entry: urlState?.entry || '' });
  if (urlState?.entry) {
    window.setTimeout(() => openEntryDeepLink(urlState.entry), 180);
  }
  setLoading('');
  notifyCodexDataStatus(c);
}

async function fetchCodex(meta) {
  const key = meta.id || meta.dataUrl;
  if (state.codexCache.has(key)) return state.codexCache.get(key);
  const url = meta.dataUrl || `data/${meta.id}.json`;
  let data;
  let sourceMeta = meta;
  let shouldCache = true;
  try {
    data = await fetchJson(url, meta.dataUrl ? 'no-store' : 'default');
  } catch (ex) {
    if (!meta.fallbackDataUrl) throw ex;
    console.warn(ex);
    shouldCache = false;
    data = await fetchJson(meta.fallbackDataUrl, 'default');
    sourceMeta = {
      ...meta,
      sourceDataUrl: meta.dataUrl,
      dataUrl: '',
      assetBaseUrl: '',
      assetPathMode: 'codex',
      dataStatus: '本地快照',
      dataNotice: '外部数据源加载失败，已使用本地快照',
      dataError: ex.message || String(ex),
      version: meta.fallbackVersion || meta.version || data.version,
    };
  }
  const codex = normalizeCodex(data, sourceMeta);
  if (shouldCache) state.codexCache.set(key, codex);
  return codex;
}

async function fetchJson(url, cache = 'default') {
  return fetch(url, { cache }).then(r => {
    if (!r.ok) throw new Error(`Failed to load codex: ${url}`);
    return r.json();
  });
}

function normalizeCodex(data, meta = {}) {
  const codex = {
    ...data,
    id: meta.id || data.id,
    title: meta.title || data.title || data.id || meta.id,
    version: meta.version || data.version || '',
    author: meta.author || data.author || '',
    nsfw: Boolean(meta.nsfw || data.nsfw),
    assetBaseUrl: stripTrailingSlash(meta.assetBaseUrl || meta.baseUrl || data.assetBaseUrl || ''),
    assetPathMode: meta.assetPathMode || data.assetPathMode || (meta.dataUrl ? 'relative' : 'codex'),
    dataUrl: meta.dataUrl || data.dataUrl || '',
    sourceDataUrl: meta.sourceDataUrl || data.sourceDataUrl || meta.dataUrl || data.dataUrl || '',
    fallbackDataUrl: meta.fallbackDataUrl || data.fallbackDataUrl || '',
    dataStatus: meta.dataStatus || data.dataStatus || (meta.dataUrl ? '外部源' : '本地数据'),
    dataNotice: meta.dataNotice || data.dataNotice || '',
    dataError: meta.dataError || data.dataError || '',
    source: meta.source || data.source || '',
    contributors: meta.contributors || data.contributors || [],
    links: meta.links || data.links || [],
  };
  codex.entries = (data.entries || []).map((entry, i) => normalizeEntry(entry, codex, i));
  codex.entryCount = Number(codex.entryCount || codex.entries.length);
  codex.imagedCount = Number(codex.imagedCount || codex.entries.filter(hasEntryImage).length);
  codex.tree = data.tree || buildTreeFromEntries(codex.entries);
  return codex;
}

function normalizeEntry(entry, codex, index) {
  const images = normalizeImageList(entry);
  const primary = images[0];
  return {
    ...entry,
    id: String(entry.id || `${codex.id}-${index + 1}`),
    title: String(entry.title || ''),
    path: Array.isArray(entry.path) ? entry.path : [],
    tags: String(entry.tags || entry.rawTags || ''),
    negative: String(entry.negative || ''),
    note: String(entry.note || ''),
    image: entry.image || primary?.path || '',
    original: entry.original || primary?.original || primary?.path || '',
    images,
  };
}

function normalizeImageList(entry) {
  const out = [];
  const seen = new Set();
  const add = (image, toFront = false) => {
    if (!image) return;
    const item = typeof image === 'string' ? { path: image } : { ...image };
    const path = item.path || item.image || item.url || item.src;
    if (!path || seen.has(path)) return;
    seen.add(path);
    const normalized = {
      ...item,
      path,
      original: item.original || path,
      rawTag: item.rawTag || item.rawTags || '',
    };
    if (toFront) out.unshift(normalized);
    else out.push(normalized);
  };
  for (const image of entry.images || []) add(image);
  if (entry.image && !seen.has(entry.image)) {
    add({ path: entry.image, original: entry.original || entry.image }, true);
  }
  if (entry.image && out.length) {
    const primaryIndex = out.findIndex(image => image.path === entry.image);
    if (primaryIndex > 0) out.unshift(out.splice(primaryIndex, 1)[0]);
    if (entry.original && out[0]?.path === entry.image) out[0].original = entry.original;
  }
  if (!out.length && entry.original) add({ path: entry.original, original: entry.original });
  return out;
}

function buildTreeFromEntries(entries) {
  const root = new Map();
  for (const entry of entries) {
    let node = root;
    for (const name of entry.path || []) {
      if (!node.has(name)) node.set(name, { name, count: 0, children: new Map() });
      const cur = node.get(name);
      cur.count++;
      node = cur.children;
    }
  }
  const toList = map => [...map.values()].map(n => ({
    name: n.name,
    count: n.count,
    children: toList(n.children),
  }));
  return toList(root);
}

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function codexStatusLabel(c) {
  if (c?.dataStatus) return c.dataStatus;
  if (c?.dataUrl) return '外部源';
  if (c?.fallbackDataUrl) return '本地快照';
  return '本地数据';
}

function codexStatusClass(c) {
  const label = codexStatusLabel(c);
  if (label.includes('快照') || label.includes('失败')) return 'warn';
  if (label.includes('外部')) return 'remote';
  return 'local';
}

function codexStatusTitle(c) {
  if (c?.dataNotice) return c.dataNotice;
  if (c?.dataUrl) return `当前读取外部源：${c.dataUrl}`;
  if (c?.sourceDataUrl && c?.fallbackDataUrl) return `外部源：${c.sourceDataUrl}\n回退快照：${c.fallbackDataUrl}`;
  if (c?.fallbackDataUrl) return `本地快照：${c.fallbackDataUrl}`;
  return '当前读取本地数据';
}

function notifyCodexDataStatus(c) {
  if (!c?.dataNotice) return;
  const key = `data:${c.id}:${c.dataStatus}:${c.dataError || c.dataNotice}`;
  if (state.sourceNoticesShown.has(key)) return;
  state.sourceNoticesShown.add(key);
  toast(c.dataNotice);
}

function setLoading(text) {
  const el = $('#loading');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  $('#main')?.classList.toggle('is-loading', Boolean(text));
}

function updateScrollProgress() {
  const bar = $('#scrollProgress');
  if (!bar) return;
  const root = document.documentElement;
  const max = Math.max(0, root.scrollHeight - window.innerHeight);
  const progress = max ? clamp(window.scrollY / max, 0, 1) : 0;
  bar.style.transform = `scaleX(${progress})`;
}

function normalizeDensity(value) {
  return DENSITY_PRESETS[value] ? value : DEFAULT_DENSITY;
}

function densityConfig() {
  return DENSITY_PRESETS[state.density] || DENSITY_PRESETS[DEFAULT_DENSITY];
}

function captureMasonryAnchor() {
  const m = $('#masonry');
  if (!m || !state.placements.length) return null;
  const mTop = m.getBoundingClientRect().top + window.scrollY;
  const viewportOffset = Math.min(window.innerHeight * 0.32, 240);
  const anchorY = Math.max(0, window.scrollY + viewportOffset - mTop);
  const placement = state.placements.find(p => p.top + p.height >= anchorY) || state.placements[0];
  if (!placement) return null;
  return {
    entryId: placement.entry.id,
    offset: clamp(anchorY - placement.top, 0, Math.max(0, placement.height - 1)),
    viewportOffset,
  };
}

function restoreMasonryAnchor(anchor) {
  if (!anchor) return;
  const m = $('#masonry');
  const placement = state.placements.find(p => p.entry.id === anchor.entryId);
  if (!m || !placement) return;
  const mTop = m.getBoundingClientRect().top + window.scrollY;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const nextTop = mTop + placement.top + Math.min(anchor.offset, Math.max(0, placement.height - 1)) - anchor.viewportOffset;
  window.scrollTo({ top: clamp(nextTop, 0, maxScroll), left: 0, behavior: 'auto' });
}

function updateDensityControls() {
  for (const btn of document.querySelectorAll('[data-density]')) {
    const active = btn.dataset.density === state.density;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function applyDensity(value, { render = true, announce = false } = {}) {
  const next = normalizeDensity(value);
  const changed = state.density !== next;
  const anchor = changed && render ? captureMasonryAnchor() : null;
  state.density = next;
  document.body.classList.remove(...Object.keys(DENSITY_PRESETS).map(k => `density-${k}`));
  document.body.classList.add(`density-${next}`);
  localStorage.setItem(DENSITY_STORAGE_KEY, next);
  updateDensityControls();
  if (!changed || !render || !state.codex) return;
  relayoutVisible({ animate: true });
  restoreMasonryAnchor(anchor);
  updateVirtualCards(true);
  updateScrollProgress();
  if (announce) toast(`卡片密度：${densityConfig().label}`);
}

/* ---------------- 目录树 ---------------- */
function renderTree() {
  const nav = $('#tree');
  nav.innerHTML = '';
  const searching = state.query.trim();
  const all = document.createElement('div');
  all.className = 'tree-row' + (!searching && !state.activePath.length ? ' active' : '');
  all.dataset.path = '';
  all.innerHTML = `<span class="tw-arrow"></span><span class="tw-name">全部</span><span class="tw-count">${state.codex.entryCount}</span>`;
  all.onclick = () => selectPath([], all);
  nav.appendChild(all);
  buildNodes(state.codex.tree, nav, [], 0);
}

function buildNodes(nodes, parent, prefix, depth) {
  for (const nd of nodes) {
    const path = prefix.concat(nd.name);
    const item = document.createElement('div');
    const active = !state.query.trim() && samePath(path, state.activePath);
    const activeAncestor = pathStartsWith(state.activePath, path);
    item.className = 'tree-item' + (depth >= 1 && !activeAncestor ? ' collapsed' : '');
    const row = document.createElement('div');
    row.className = 'tree-row' + (active ? ' active' : '');
    row.dataset.path = path.join('\u0001');
    const hasKids = nd.children && nd.children.length;
    row.innerHTML =
      `<span class="tw-arrow">${hasKids ? '▾' : ''}</span>` +
      `<span class="tw-name">${esc(nd.name)}</span><span class="tw-count">${nd.count}</span>`;
    row.querySelector('.tw-arrow').onclick = e => { e.stopPropagation(); item.classList.toggle('collapsed'); };
    row.onclick = () => { selectPath(path, row); if (hasKids) item.classList.remove('collapsed'); };
    item.appendChild(row);
    if (hasKids) {
      const kids = document.createElement('div');
      kids.className = 'tree-children';
      buildNodes(nd.children, kids, path, depth + 1);
      item.appendChild(kids);
    }
    parent.appendChild(item);
  }
}

function selectPath(path, rowEl) {
  state.activePath = path;
  state.query = '';
  $('#search').value = '';
  updateSearchClear();
  document.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
  rowEl.classList.add('active');
  if (window.innerWidth <= 600) $('#sidebar').classList.add('closed');
  applyFilter({ resetScroll: true });
  syncUrlState();
}

/* 面包屑点击：按路径找到目录行，展开祖先并选中 */
function selectPathByPath(path) {
  const key = path.join('\u0001');
  for (const row of document.querySelectorAll('.tree-row')) {
    if ((row.dataset.path || '') !== key) continue;
    let item = row.closest('.tree-item');
    while (item) {
      item.classList.remove('collapsed');
      item = item.parentElement ? item.parentElement.closest('.tree-item') : null;
    }
    selectPath(path, row);
    row.scrollIntoView({ block: 'nearest' });
    return;
  }
}

/* ---------------- 过滤 ---------------- */
function applyFilter(options = {}) {
  const plan = parseSearchQuery(state.query);
  state.searchPlan = plan;
  let list = state.codex.entries;
  if (plan.raw) {
    list = list.filter(e => matchSearchPlan(e, plan));
  } else if (state.activePath.length) {
    const p = state.activePath;
    list = list.filter(e => p.every((seg, i) => e.path[i] === seg));
  }
  if (state.onlyImaged) list = list.filter(hasEntryImage);
  if (state.onlyFav) list = list.filter(e => state.favs.has(favKey(e)));
  state.list = list;
  updateResultBar();
  renderList(options);
}

function searchableText(e) {
  return [e.title, e.tags, e.negative, e.note, e.rawTags, ...(e.path || [])]
    .join('\n')
    .toLowerCase();
}

function parseSearchQuery(raw) {
  const input = String(raw || '').trim();
  if (!input) return { raw: '', isSyntax: false, text: '', highlightTerms: [] };
  const tokens = splitQueryTokens(input);
  const plan = {
    raw: input,
    isSyntax: false,
    text: '',
    path: null,
    hasImage: null,
    fav: null,
    author: '',
    highlightTerms: [],
  };
  const terms = [];
  let invalidSyntax = false;

  for (const token of tokens) {
    const match = token.match(/^(path|has|fav|author):(.+)$/i);
    if (!match) {
      terms.push(token);
      continue;
    }
    plan.isSyntax = true;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (!value) {
      invalidSyntax = true;
      break;
    }
    if (key === 'path') {
      const path = value.split('/').map(seg => seg.trim()).filter(Boolean);
      if (!path.length) invalidSyntax = true;
      else plan.path = path;
    } else if (key === 'has') {
      const v = value.toLowerCase();
      if (['image', 'img', 'true', 'yes', '有图'].includes(v)) plan.hasImage = true;
      else if (['noimage', 'none', 'false', 'no', '无图'].includes(v)) plan.hasImage = false;
      else invalidSyntax = true;
    } else if (key === 'fav') {
      const v = value.toLowerCase();
      if (['true', '1', 'yes', '收藏'].includes(v)) plan.fav = true;
      else if (['false', '0', 'no', '未收藏'].includes(v)) plan.fav = false;
      else invalidSyntax = true;
    } else if (key === 'author') {
      plan.author = value.toLowerCase();
    }
    if (invalidSyntax) break;
  }

  if (invalidSyntax) {
    return {
      raw: input,
      isSyntax: false,
      text: input.toLowerCase(),
      highlightTerms: highlightTermsFromText(input),
    };
  }

  plan.text = terms.join(' ').trim().toLowerCase();
  plan.highlightTerms = highlightTermsFromText(terms.join(' '));
  if (!plan.isSyntax) {
    plan.text = input.toLowerCase();
    plan.highlightTerms = highlightTermsFromText(input);
  }
  return plan;
}

function splitQueryTokens(input) {
  const tokens = [];
  let buf = '';
  let quote = '';
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = '';
      else buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

function matchSearchPlan(e, plan) {
  if (!plan.isSyntax) return searchableText(e).includes(plan.text);
  if (plan.text && !searchableText(e).includes(plan.text)) return false;
  if (plan.path && !pathMatchesQuery(e.path || [], plan.path)) return false;
  if (plan.hasImage !== null && hasEntryImage(e) !== plan.hasImage) return false;
  if (plan.fav !== null && state.favs.has(favKey(e)) !== plan.fav) return false;
  if (plan.author && !entryAuthorText(e).includes(plan.author)) return false;
  return true;
}

function pathMatchesQuery(path, queryPath) {
  if (!queryPath.length) return true;
  const joined = path.join('/').toLowerCase();
  const qJoined = queryPath.join('/').toLowerCase();
  if (joined.includes(qJoined)) return true;
  return queryPath.every(seg => path.some(p => String(p).toLowerCase().includes(seg.toLowerCase())));
}

function entryAuthorText(e) {
  const imageAuthors = entryImages(e).flatMap(img => [img.author, img.credit]);
  const contributors = Array.isArray(state.codex?.contributors) ? state.codex.contributors.map(p => typeof p === 'string' ? p : `${p.name || ''} ${p.role || ''}`) : [];
  return [state.codex?.author, state.codex?.source, e.author, e.credit, ...imageAuthors, ...contributors]
    .join('\n')
    .toLowerCase();
}

function highlightTermsFromText(text) {
  const terms = String(text || '')
    .split(/[\s,，、]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(terms.map(s => s.toLowerCase()))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
}

function currentHighlightTerms() {
  return state.searchPlan?.highlightTerms || [];
}

function renderHighlightedText(el, text, terms = []) {
  if (!el) return;
  const raw = String(text || '');
  const needles = terms.filter(Boolean);
  if (!needles.length) {
    el.textContent = raw;
    return;
  }
  const lower = raw.toLowerCase();
  const frag = document.createDocumentFragment();
  let pos = 0;
  while (pos < raw.length) {
    let bestIndex = -1;
    let bestTerm = '';
    for (const term of needles) {
      const index = lower.indexOf(term, pos);
      if (index === -1) continue;
      if (bestIndex === -1 || index < bestIndex || (index === bestIndex && term.length > bestTerm.length)) {
        bestIndex = index;
        bestTerm = term;
      }
    }
    if (bestIndex === -1) {
      frag.appendChild(document.createTextNode(raw.slice(pos)));
      break;
    }
    if (bestIndex > pos) frag.appendChild(document.createTextNode(raw.slice(pos, bestIndex)));
    const mark = document.createElement('mark');
    mark.textContent = raw.slice(bestIndex, bestIndex + bestTerm.length);
    frag.appendChild(mark);
    pos = bestIndex + bestTerm.length;
  }
  el.replaceChildren(frag);
}

function hasEntryImage(e) {
  return Boolean((e.images && e.images.length) || e.image);
}

function updateResultBar() {
  const n = state.list.length;
  const box = $('#resultInfo');
  box.innerHTML = '';
  const q = state.query.trim();

  const crumbs = document.createElement('span');
  crumbs.className = 'crumbs';
  const addChip = (label, path, isCurrent) => {
    const chip = document.createElement(isCurrent ? 'span' : 'button');
    chip.className = 'crumb' + (isCurrent ? ' current' : '');
    chip.textContent = label;
    if (!isCurrent) {
      chip.type = 'button';
      chip.onclick = () => selectPathByPath(path);
    }
    crumbs.appendChild(chip);
  };
  const addSep = () => {
    const s = document.createElement('span');
    s.className = 'crumb-sep';
    s.textContent = '›';
    crumbs.appendChild(s);
  };
  if (q) {
    addChip('全部', [], false);
  } else {
    addChip('全部', [], state.activePath.length === 0);
    state.activePath.forEach((seg, i) => {
      addSep();
      addChip(seg, state.activePath.slice(0, i + 1), i === state.activePath.length - 1);
    });
  }
  box.appendChild(crumbs);

  const count = document.createElement('span');
  let t;
  if (q) t = `${state.searchPlan?.isSyntax ? '筛选' : '搜索'} “${esc(q)}”：<b>${n}</b> 条结果`;
  else if (state.onlyFav) t = `⭐ 我的收藏：<b>${n}</b> 条`;
  else if (state.activePath.length) t = `<b>${n}</b> 条`;
  else t = `共 <b>${n}</b> 条词条 · ${state.codex.imagedCount} 条已配图`;
  count.innerHTML = t;
  box.appendChild(count);

  updateEmptyState(n);
  updateRailActive();
}

function updateEmptyState(n) {
  const empty = $('#empty');
  if (!empty) return;
  empty.hidden = n > 0;
  if (n > 0) return;

  const q = state.query.trim();
  const hasFilter = state.onlyImaged || state.onlyFav || state.activePath.length || q;
  let title = '这里还没有词条';
  let desc = '换个分类或稍后再来看看。';
  const actions = [];

  if (q) {
    title = state.searchPlan?.isSyntax ? '没有符合条件的筛选结果' : '没有找到匹配词条';
    desc = state.searchPlan?.isSyntax
      ? '删掉一两个筛选条件，或加一个普通关键词继续缩小范围。'
      : '试试换个关键词，或清空搜索回到当前法典。';
    actions.push({ label: '清空搜索', action: 'clear-search' });
  } else if (state.onlyFav) {
    title = '收藏夹还是空的';
    desc = '先在卡片右上角点星标收藏，之后就能在这里集中查看。';
    actions.push({ label: '查看全部词条', action: 'show-all' });
  } else if (state.onlyImaged) {
    title = '这个范围里暂时没有配图';
    desc = '关闭“只看有图”后，可以查看待配图词条。';
    actions.push({ label: '关闭只看有图', action: 'show-unimaged' });
  } else if (state.activePath.length) {
    title = '这个分类还没有词条';
    desc = '可以返回全部，或从上方横向分类继续逛。';
    actions.push({ label: '返回全部', action: 'show-all' });
  } else if (!hasFilter) {
    desc = '当前法典暂未提供可显示的词条数据。';
  }

  empty.innerHTML =
    `<div class="empty-mark" aria-hidden="true">—</div>` +
    `<h2>${esc(title)}</h2>` +
    `<p>${esc(desc)}</p>` +
    (actions.length ? `<div class="empty-actions">${actions.map(a => `<button type="button" data-empty-action="${esc(a.action)}">${esc(a.label)}</button>`).join('')}</div>` : '');

  empty.querySelectorAll('[data-empty-action]').forEach(btn => {
    btn.onclick = () => handleEmptyAction(btn.dataset.emptyAction);
  });
}

function handleEmptyAction(action) {
  if (action === 'clear-search') {
    state.query = '';
    const search = $('#search');
    if (search) search.value = '';
    updateSearchClear();
    renderTree();
  } else if (action === 'show-unimaged') {
    state.onlyImaged = false;
    const onlyImaged = $('#onlyImaged');
    if (onlyImaged) onlyImaged.checked = false;
  } else if (action === 'show-all') {
    state.query = '';
    state.activePath = [];
    state.onlyFav = false;
    state.onlyImaged = false;
    const search = $('#search');
    if (search) search.value = '';
    const onlyFav = $('#onlyFav');
    if (onlyFav) onlyFav.checked = false;
    const onlyImaged = $('#onlyImaged');
    if (onlyImaged) onlyImaged.checked = false;
    updateSearchClear();
    renderTree();
  }
  applyFilter({ resetScroll: true });
  syncUrlState();
}

function readUrlState() {
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  const path = (params.get('path') || '')
    .split('/')
    .map(seg => seg.trim())
    .filter(Boolean);
  return {
    codex: params.get('codex') || '',
    path,
    q: params.get('q') || '',
    entry: params.get('entry') || hash.get('entry') || '',
  };
}

function syncUrlState({ replace = true, entry } = {}) {
  if (state.suppressUrlSync || !state.codex) return;
  const params = new URLSearchParams();
  params.set('codex', state.codex.id);
  const q = state.query.trim();
  if (q) params.set('q', q);
  else if (state.activePath.length) params.set('path', state.activePath.join('/'));
  const entryId = entry === undefined ? (state.lightbox.entry?.id || '') : entry;
  if (entryId) params.set('entry', entryId);
  scheduleBrowseStateSave(entryId);
  const next = `${location.pathname}?${params.toString()}`;
  if (next === location.pathname + location.search && !location.hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', next);
}

function openEntryDeepLink(entryId) {
  if (!state.codex || !entryId) return;
  const entry = state.codex.entries.find(e => e.id === entryId);
  if (!entry) return;
  if (!state.query && !state.activePath.length && entry.path?.length) {
    state.activePath = entry.path;
    renderTree();
    applyFilter({ resetScroll: true });
  }
  const index = state.list.findIndex(e => e.id === entry.id);
  const placement = index >= 0 ? state.placements[index] : null;
  if (placement) {
    const top = Math.max(0, placement.top + $('#masonry').getBoundingClientRect().top + window.scrollY - 120);
    window.scrollTo({ top, left: 0, behavior: 'auto' });
    updateVirtualCards(true);
  }
  if (hasEntryImage(entry)) {
    const node = index >= 0 ? state.nodes.get(index) : null;
    const img = node?.querySelector('.card-img');
    openLightbox(entry, 0, img || null);
  } else {
    toast('这个词条还没有例图');
    syncUrlState({ entry: '' });
  }
}

function randomExplore() {
  if (!state.codex) return;
  if (!state.list.length) {
    toast('当前结果为空，换个筛选再试试', '!');
    return;
  }
  const candidates = state.list.filter(hasEntryImage);
  if (!candidates.length) {
    toast('当前筛选下没有可随机探索的配图词条', '!');
    return;
  }
  const recent = new Set(state.recentRandomIds);
  let pool = candidates.filter(e => !recent.has(randomKey(e)));
  if (!pool.length) {
    pool = candidates;
    state.recentRandomIds = [];
  }
  const entry = pool[Math.floor(Math.random() * pool.length)];
  rememberRandomEntry(entry);
  openRandomEntry(entry);
}

function randomKey(entry) {
  return `${state.codex?.id || ''}:${entry.id}`;
}

function rememberRandomEntry(entry) {
  const key = randomKey(entry);
  state.recentRandomIds = [key, ...state.recentRandomIds.filter(id => id !== key)].slice(0, RANDOM_RECENT_LIMIT);
}

function openRandomEntry(entry) {
  const index = state.list.findIndex(e => e.id === entry.id);
  const placement = index >= 0 ? state.placements[index] : null;
  if (placement) {
    const top = Math.max(0, placement.top + $('#masonry').getBoundingClientRect().top + window.scrollY - 120);
    window.scrollTo({ top, left: 0, behavior: 'auto' });
    updateVirtualCards(true);
  }
  requestAnimationFrame(() => {
    const node = index >= 0 ? state.nodes.get(index) : null;
    const img = node?.querySelector('.card-img');
    openLightbox(entry, 0, img || null);
    toast(`随机到了：${entry.title}`, '');
  });
}

/* ---------------- 法典横幅 / 分类轨道 ---------------- */
function renderCodexHeader() {
  const c = state.codex;
  const banner = $('#codexBanner');
  if (!banner) return;
  const cover = c.entries.find(hasEntryImage);
  const pct = c.entryCount ? Math.round((c.imagedCount / c.entryCount) * 100) : 0;
  const metaText = [c.author, c.version].filter(Boolean).join(' · ');
  const statusLabel = codexStatusLabel(c);
  banner.innerHTML =
    `<div class="banner-cover">${cover ? `<img src="${esc(thumbUrl(cover))}" alt="">` : ''}</div>` +
    `<div class="banner-info">` +
    `<div class="banner-title">${esc(c.title)}</div>` +
    `<div class="banner-meta"><span>${esc(metaText)}</span><span class="data-pill ${codexStatusClass(c)}" title="${esc(codexStatusTitle(c))}">${esc(statusLabel)}</span></div>` +
    `<div class="banner-progress"><div class="bp-track"><div class="bp-fill" style="width:${pct}%"></div></div>` +
    `<span class="bp-text">${c.imagedCount} / ${c.entryCount} 已配图</span></div>` +
    `</div>`;
  renderBannerAbout(c, banner);
  const rail = $('#chipRail');
  if (!rail) return;
  rail.innerHTML = '';
  const mkChip = (label, path, count, hue) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rail-chip';
    chip.dataset.path = path.join('\u0001');
    chip.innerHTML = `<span class="rc-dot" style="background:${hue}"></span>${esc(label)}<span class="rc-n">${count}</span>`;
    chip.onclick = () => selectPathByPath(path);
    rail.appendChild(chip);
  };
  mkChip('全部', [], c.entryCount, 'var(--accent)');
  for (const nd of c.tree) {
    let h = 0;
    for (const ch of nd.name) h = (h * 31 + ch.codePointAt(0)) % 360;
    mkChip(nd.name, [nd.name], nd.count, `hsl(${h},58%,52%)`);
  }
  updateRailActive();
}

function updateRailActive() {
  const rail = $('#chipRail');
  if (!rail) return;
  const head = state.query.trim() ? null : (state.activePath[0] || '');
  rail.querySelectorAll('.rail-chip').forEach(ch => {
    ch.classList.toggle('active', head !== null && (ch.dataset.path || '') === head);
  });
}

/* 法典「关于」气泡：来源 / 贡献者 / 相关链接 */
const EXT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

function closeBannerAbout() {
  const openBtn = document.querySelector('.banner-about-btn.open');
  const openPop = document.querySelector('.banner-pop:not([hidden])');
  if (!openBtn || !openPop) return;
  openPop.hidden = true;
  openBtn.classList.remove('open');
}

function renderBannerAbout(c, banner) {
  const contributors = Array.isArray(c.contributors) ? c.contributors : [];
  const links = Array.isArray(c.links) ? c.links : [];
  if (!c.source && !contributors.length && !links.length && !c.dataStatus) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'banner-about-btn';
  btn.title = '关于本法典';
  btn.setAttribute('aria-label', '关于本法典');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.25"/><path d="M12 11v4.5"/><path d="M12 8.25h.01"/></svg>';

  const pop = document.createElement('div');
  pop.className = 'banner-pop';
  pop.hidden = true;
  let html = '';
  if (c.source) html += `<div class="bp-sub">来源</div><div class="bp-source">${esc(c.source)}</div>`;
  html += `<div class="bp-sub">数据</div><div class="bp-data"><span class="data-pill ${codexStatusClass(c)}">${esc(codexStatusLabel(c))}</span>${c.dataNotice ? `<small>${esc(c.dataNotice)}</small>` : ''}</div>`;
  if (contributors.length) {
    html += '<div class="bp-sub">贡献者</div><div class="bp-contrib">';
    for (const p of contributors) {
      const name = typeof p === 'string' ? p : (p.name || '');
      const role = typeof p === 'string' ? '' : (p.role || '');
      if (!name) continue;
      html += `<span class="bp-chip">${esc(name)}${role ? `<small>${esc(role)}</small>` : ''}</span>`;
    }
    html += '</div>';
  }
  const validLinks = links.filter(l => l && l.url && l.url !== '#');
  if (validLinks.length) {
    html += '<div class="bp-sub">相关链接</div>';
    for (const l of validLinks) {
      html += `<a class="bp-link" href="${esc(l.url)}" target="_blank" rel="noopener">${EXT_ICON}<span>${esc(l.label || l.url)}</span></a>`;
    }
  }
  html += '<button class="bp-archive" type="button">查看完整档案</button>';
  pop.innerHTML = html;
  pop.querySelector('.bp-archive')?.addEventListener('click', ev => {
    ev.stopPropagation();
    document.dispatchEvent(new CustomEvent('openCodexArchive', { detail: { trigger: ev.currentTarget } }));
  });

  btn.onclick = ev => {
    ev.stopPropagation();
    const show = pop.hidden;
    closeBannerAbout();
    pop.hidden = !show;
    btn.classList.toggle('open', show);
  };

  banner.appendChild(btn);
  banner.appendChild(pop);
}

function renderCodexArchive() {
  const c = state.codex;
  const body = $('#archiveBody');
  if (!c || !body) return;
  const pct = c.entryCount ? Math.round((c.imagedCount / c.entryCount) * 100) : 0;
  const contributors = Array.isArray(c.contributors) ? c.contributors : [];
  const links = (Array.isArray(c.links) ? c.links : []).filter(l => l && l.url && l.url !== '#');
  const statRows = [
    ['作者', c.author || '未标注'],
    ['版本', c.version || '未标注'],
    ['词条', `${c.entryCount} 条`],
    ['配图', `${c.imagedCount} / ${c.entryCount} (${pct}%)`],
    ['数据', codexStatusLabel(c)],
  ];
  if (c.dataNotice) statRows.push(['状态说明', c.dataNotice]);
  if (c.dataError) statRows.push(['失败原因', c.dataError]);
  if (c.sourceDataUrl) statRows.push(['外部源', c.sourceDataUrl]);
  else if (c.dataUrl) statRows.push(['源地址', c.dataUrl]);
  if (c.fallbackDataUrl) statRows.push(['回退', c.fallbackDataUrl]);
  body.innerHTML =
    `<div class="archive-hero">` +
    `<div><div class="archive-title">${esc(c.title)}</div><div class="archive-sub">${esc(c.source || '本地整理数据')}</div></div>` +
    `<div class="archive-pct">${pct}%<span>配图率</span></div>` +
    `</div>` +
    `<div class="archive-grid">${statRows.map(([k, v]) => `<div class="archive-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` +
    (contributors.length ? `<div class="archive-section"><h3>贡献者</h3><div class="archive-chips">${contributors.map(p => {
      const name = typeof p === 'string' ? p : (p.name || '');
      const role = typeof p === 'string' ? '' : (p.role || '');
      return name ? `<span>${esc(name)}${role ? `<small>${esc(role)}</small>` : ''}</span>` : '';
    }).join('')}</div></div>` : '') +
    (links.length ? `<div class="archive-section"><h3>相关链接</h3>${links.map(l => `<a class="archive-link" href="${esc(l.url)}" target="_blank" rel="noopener">${EXT_ICON}<span>${esc(l.label || l.url)}</span></a>`).join('')}</div>` : '') +
    `<div class="archive-section"><h3>说明</h3><p>本站保留原法典结构，优先服务看图选词和一键复制。外部源法典会优先读取线上数据，失败时使用本地快照。</p></div>`;
}

/* 关于本站（设置框）+ 侧栏小贴士轮播 */
let tipTimer = 0;
let tipIndex = 0;
function setupAbout() {
  const about = state.about || {};
  const links = Array.isArray(about.links) ? about.links : [];
  const tips = Array.isArray(about.tips) ? about.tips : [];
  const credits = Array.isArray(about.credits) ? about.credits : [];

  const intro = $('#aboutIntro');
  if (intro) intro.textContent = about.intro || '';

  const linkBox = $('#aboutLinks');
  if (linkBox) {
    linkBox.innerHTML = '';
    for (const l of links) {
      if (!l || !l.label) continue;
      const real = l.url && l.url !== '#';
      const el = document.createElement(real ? 'a' : 'div');
      el.className = 'about-link';
      if (real) { el.href = l.url; el.target = '_blank'; el.rel = 'noopener'; }
      el.innerHTML =
        `<span class="al-text"><span class="al-label">${esc(l.label)}</span>` +
        `<span class="al-desc">${esc(l.desc || (real ? l.url : '链接待补充'))}</span></span>` +
        (real ? `<span class="al-ext">${EXT_ICON}</span>` : '');
      linkBox.appendChild(el);
    }
  }

  const tipBox = $('#aboutTips');
  if (tipBox) {
    tipBox.innerHTML = '';
    for (const t of tips) {
      const li = document.createElement('li');
      li.textContent = t;
      tipBox.appendChild(li);
    }
  }

  const credBox = $('#aboutCredits');
  if (credBox) {
    credBox.innerHTML = '';
    for (const c of credits) {
      const p = document.createElement('p');
      p.textContent = c;
      credBox.appendChild(p);
    }
  }

  /* 侧栏底：轮播贴士 */
  const foot = $('#sbFoot');
  const tipText = $('#sbTipText');
  if (foot && tipText && tips.length) {
    tipIndex = Math.floor(Math.random() * tips.length);
    tipText.textContent = tips[tipIndex];
    const rotate = () => {
      tipText.classList.add('fade');
      window.setTimeout(() => {
        tipIndex = (tipIndex + 1) % tips.length;
        tipText.textContent = tips[tipIndex];
        tipText.classList.remove('fade');
      }, 280);
    };
    const restart = () => {
      clearInterval(tipTimer);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        tipTimer = window.setInterval(rotate, 9000);
      }
    };
    $('#sbTip').onclick = () => { rotate(); restart(); };
    restart();
    foot.hidden = false;
  }
}

/* ---------------- 虚拟瀑布流 ---------------- */
function colCount() {
  const w = $('#masonry').clientWidth || $('#main').clientWidth;
  const cfg = densityConfig();
  return Math.max(1, Math.floor((w + cfg.gap) / (cfg.minWidth + cfg.gap)));
}

function clearMasonry() {
  for (const node of state.nodes.values()) cleanupCard(node);
  state.nodes.clear();
  state.placements = [];
  state.rendered = 0;
  const m = $('#masonry');
  if (m) {
    relayoutAnimating = false;
    clearTimeout(relayoutAnimTimer);
    m.classList.remove('is-relayouting');
    m.innerHTML = '';
    m.style.height = '0px';
  }
}

function renderList({ resetScroll = false } = {}) {
  clearMasonry();
  if (resetScroll) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  computeLayout();
  updateVirtualCards(true);
  updateScrollProgress();
}

function computeLayout() {
  const m = $('#masonry');
  const width = Math.max(1, m.clientWidth || $('#main').clientWidth || 1);
  const cfg = densityConfig();
  const n = colCount();
  const itemWidth = Math.max(180, Math.floor((width - cfg.gap * (n - 1)) / n));
  const colHeights = Array.from({ length: n }, () => 0);
  const placements = [];

  for (let i = 0; i < state.list.length; i++) {
    const entry = state.list[i];
    const col = shortestIndex(colHeights);
    const imageHeight = estimateImageHeight(entry, itemWidth);
    const body = estimateBodyMetrics(entry, itemWidth);
    const height = Math.ceil(imageHeight + body.height);
    const left = col * (itemWidth + cfg.gap);
    const top = colHeights[col];

    placements.push({
      index: i,
      entry,
      col,
      left,
      top,
      width: itemWidth,
      height,
      imageHeight,
      tagsHeight: body.tagsHeight,
    });
    colHeights[col] += height + cfg.gap;
  }

  state.placements = placements;
  state.colN = n;
  state.itemWidth = itemWidth;
  const totalHeight = placements.length ? Math.max(...colHeights) - cfg.gap : 0;
  m.style.height = `${Math.max(0, Math.ceil(totalHeight))}px`;
}

function shortestIndex(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[best]) best = i;
  }
  return best;
}

function estimateImageHeight(e, width) {
  if (!hasEntryImage(e)) return 0;
  const iw = Number(e.imageWidth || e.width || e.thumbWidth);
  const ih = Number(e.imageHeight || e.height || e.thumbHeight);
  const ratio = iw > 0 && ih > 0 ? ih / iw : DEFAULT_IMAGE_RATIO;
  return Math.round(width * clamp(ratio, 0.55, 1.9));
}

function estimateBodyMetrics(e, width) {
  const cfg = densityConfig();
  const contentWidth = Math.max(120, width - cfg.bodyPadX * 2);
  const titleLines = clamp(Math.ceil(textUnits(e.title) / Math.max(8, Math.floor(contentWidth / cfg.titleCharWidth))), 1, 2);
  const tagLines = estimateTagLines(e.tags, contentWidth, cfg);
  const titleHeight = titleLines * cfg.titleLineHeight;
  const tagsHeight = clamp(tagLines * cfg.tagLineHeight + cfg.tagPaddingY, cfg.minTagHeight, cfg.maxTagHeight);
  const footHeight = e.negative ? cfg.footHeightNegative : cfg.footHeight;
  return {
    height: Math.ceil(cfg.bodyPadTop + titleHeight + cfg.titleGap + tagsHeight + cfg.footGap + footHeight + cfg.bodyPadBottom),
    tagsHeight,
  };
}

function estimateTagLines(text, width, cfg = densityConfig()) {
  const perLine = Math.max(18, Math.floor(width / cfg.tagCharWidth));
  const lines = String(text || '').split(/\n+/).reduce((sum, line) => {
    return sum + Math.max(1, Math.ceil(textUnits(line) / perLine));
  }, 0);
  return clamp(lines, 1, cfg.maxTagLines);
}

function textUnits(text) {
  let units = 0;
  for (const ch of String(text || '')) units += /[\u4e00-\u9fff]/.test(ch) ? 2 : 1;
  return units;
}

let virtualRaf = 0;
let relayoutTimer = 0;
let relayoutAnimTimer = 0;
let relayoutQueuedAnimate = false;
let relayoutAnimating = false;
let lastRelayoutAt = 0;
function scheduleVirtualUpdate() {
  if (virtualRaf) return;
  virtualRaf = requestAnimationFrame(() => {
    virtualRaf = 0;
    updateVirtualCards();
  });
}

function masonryViewport(m) {
  const rect = m.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const totalHeight = m.offsetHeight || parseFloat(m.style.height) || 0;
  const maxTop = Math.max(0, totalHeight - viewportHeight);
  const rawTop = -rect.top;
  return {
    rect,
    viewportHeight,
    rawTop,
    top: clamp(rawTop, 0, maxTop),
  };
}

function updateVirtualCards(force = false) {
  const m = $('#masonry');
  if (!m || !state.placements.length) {
    state.rendered = 0;
    return;
  }

  const view = masonryViewport(m);
  const viewportTop = view.top;
  const viewportHeight = view.viewportHeight;
  const rangeTop = Math.max(0, viewportTop - viewportHeight * VIRTUAL_BUFFER_UP);
  const rangeBottom = viewportTop + viewportHeight * (1 + VIRTUAL_BUFFER_DOWN);
  const next = new Set();

  for (const placement of state.placements) {
    if (placement.top + placement.height < rangeTop || placement.top > rangeBottom) continue;
    next.add(placement.index);
    let node = state.nodes.get(placement.index);
    if (!node) {
      node = makeCard(placement);
      state.nodes.set(placement.index, node);
      m.appendChild(node);
      if (!relayoutAnimating) calibrateCardHeight(node, placement);
    } else if (force) {
      updateCardPosition(node, placement);
      if (!relayoutAnimating) calibrateCardHeight(node, placement);
    }
  }

  for (const [index, node] of state.nodes) {
    if (next.has(index)) continue;
    if (force && relayoutAnimating) {
      const placement = state.placements[index];
      if (placement) updateCardPosition(node, placement);
      continue;
    }
    cleanupCard(node);
    node.remove();
    state.nodes.delete(index);
  }
  state.rendered = next.size;
}

function makeCard(placement) {
  const e = placement.entry;
  const node = $('#cardTpl').content.firstElementChild.cloneNode(true);
  node.dataset.index = String(placement.index);
  updateCardPosition(node, placement);

  node.querySelector('.card-title').textContent = e.title;
  renderHighlightedText(node.querySelector('.card-tags'), e.tags, currentHighlightTerms());
  node.querySelector('.card-path').textContent = e.path.join(' › ');
  if (e.isNew) node.querySelector('.badge-new').hidden = false;

  const hasImage = hasEntryImage(e);
  const hasNegative = !!(e.negative && String(e.negative).trim());
  const imageCount = entryImages(e).length;
  const negBadge = node.querySelector('.badge-neg');
  if (negBadge) negBadge.hidden = !(hasImage && hasNegative);
  const countBadge = node.querySelector('.badge-count');
  if (countBadge) {
    countBadge.hidden = imageCount <= 1;
    const count = countBadge.querySelector('.badge-count-n');
    if (count) count.textContent = String(imageCount);
  }
  const negChip = node.querySelector('.badge-neg-chip');
  if (negChip) negChip.hidden = hasImage || !hasNegative;

  const negBtn = node.querySelector('.copy-negative');
  if (negBtn) {
    negBtn.hidden = !e.negative;
    negBtn.onclick = ev => { ev.stopPropagation(); copyText(e.negative, `已复制负面：${e.title}`, node); };
  }
  const allBtn = node.querySelector('.copy-all');
  if (allBtn) {
    allBtn.hidden = !e.negative;
    allBtn.onclick = ev => { ev.stopPropagation(); copyText(combinedPrompt(e), `已复制正向+负面：${e.title}`, node); };
  }

  const fav = node.querySelector('.fav-btn');
  const faved = state.favs.has(favKey(e));
  fav.textContent = faved ? '★' : '☆';
  fav.classList.toggle('on', faved);
  fav.title = faved ? '取消收藏' : '收藏';
  fav.setAttribute('aria-label', faved ? '取消收藏' : '收藏');
  fav.onclick = ev => { ev.stopPropagation(); toggleFav(e, fav); };

  if (hasImage) {
    setupImage(node, placement);
  } else {
    node.classList.add('no-img');
  }

  node.onclick = () => copyEntry(e, node);
  maybeAnimateCardEntry(node, placement);
  return node;
}

function samePath(a, b) {
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

function pathStartsWith(path, prefix) {
  return prefix.length <= path.length && prefix.every((seg, i) => seg === path[i]);
}

function updateCardPosition(node, placement) {
  node.style.width = `${placement.width}px`;
  node.style.height = `${placement.height}px`;
  node.style.setProperty('--card-x', `${placement.left}px`);
  node.style.setProperty('--card-y', `${placement.top}px`);
  if (!node.style.getPropertyValue('--entry-offset')) node.style.setProperty('--entry-offset', '0px');
  node.style.transform = 'translate3d(var(--card-x), calc(var(--card-y) + var(--entry-offset, 0px)), 0)';
  const wrap = node.querySelector('.card-img-wrap');
  if (wrap && placement.imageHeight) wrap.style.height = `${placement.imageHeight}px`;
  const tags = node.querySelector('.card-tags');
  if (tags) tags.style.height = `${placement.tagsHeight}px`;
}

function maybeAnimateCardEntry(node, placement) {
  if (prefersReducedMotion() || relayoutAnimating || !state.codex) return;
  const key = `${state.codex.id}:${placement.entry.id}`;
  if (state.seenAnimated.has(key)) return;
  state.seenAnimated.add(key);

  const delay = Math.min(210, placement.col * 30 + (placement.index % Math.max(1, state.colN)) * 10);
  node.style.setProperty('--entry-offset', '18px');
  node.style.setProperty('--entry-delay', `${delay}ms`);
  node.classList.add('card-enter');
  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    node.classList.add('is-entered');
    node.style.setProperty('--entry-offset', '0px');
  });
  window.setTimeout(() => {
    node.classList.remove('card-enter', 'is-entered');
    node.style.removeProperty('--entry-delay');
  }, delay + 560);
}

function calibrateCardHeight(node, placement) {
  const tags = node.querySelector('.card-tags');
  if (tags) {
    const cfg = densityConfig();
    tags.style.height = 'auto';
    const naturalTagsHeight = Math.ceil(tags.scrollHeight);
    const tagsHeight = clamp(naturalTagsHeight, cfg.minTagHeight, cfg.maxTagHeight);
    tags.style.height = `${tagsHeight}px`;
    tags.classList.toggle('is-clipped', naturalTagsHeight > tagsHeight + 1);
    placement.tagsHeight = tagsHeight;
  }

  const wrap = node.querySelector('.card-img-wrap');
  const body = node.querySelector('.card-body');
  const imageHeight = wrap && !wrap.hidden && getComputedStyle(wrap).display !== 'none'
    ? wrap.getBoundingClientRect().height
    : 0;
  const bodyHeight = body ? body.getBoundingClientRect().height : 0;
  const measuredHeight = Math.ceil(imageHeight + bodyHeight);
  if (measuredHeight > 0 && Math.abs(measuredHeight - placement.height) > 2) {
    shiftColumnAfterHeightChange(placement, measuredHeight);
  }
}

function shiftColumnAfterHeightChange(placement, nextHeight) {
  const delta = nextHeight - placement.height;
  placement.height = nextHeight;
  const currentNode = state.nodes.get(placement.index);
  if (currentNode) currentNode.style.height = `${placement.height}px`;

  for (const next of state.placements) {
    if (next === placement || next.col !== placement.col || next.top <= placement.top) continue;
    next.top += delta;
    const node = state.nodes.get(next.index);
    if (node) updateCardPosition(node, next);
  }
  syncMasonryHeight();
}

function syncMasonryHeight() {
  const m = $('#masonry');
  if (!m || !state.placements.length) return;
  const totalHeight = Math.max(...state.placements.map(p => p.top + p.height));
  m.style.height = `${Math.max(0, Math.ceil(totalHeight))}px`;
}

function setupImage(node, placement) {
  const e = placement.entry;
  const wrap = node.querySelector('.card-img-wrap');
  const img = node.querySelector('.card-img');
  const retryBtn = node.querySelector('.img-retry');
  const url = thumbUrl(e);
  const key = imageKey(e, url);

  wrap.hidden = false;
  wrap.style.height = `${placement.imageHeight}px`;
  img.alt = e.title;

  const markLoading = () => {
    wrap.classList.add('is-loading');
    wrap.classList.remove('is-error');
    img.classList.remove('is-loaded');
    if (retryBtn) retryBtn.hidden = true;
  };
  const markLoaded = () => {
    state.loadedImages.add(key);
    wrap.classList.remove('is-loading', 'is-error');
    img.classList.add('is-loaded');
    if (retryBtn) retryBtn.hidden = true;
  };
  const markError = () => {
    wrap.classList.remove('is-loading');
    wrap.classList.add('is-error');
    if (retryBtn) retryBtn.hidden = false;
    notifyImageLoadError(e);
  };
  const load = (retry = false) => {
    node._imageTimer = 0;
    markLoading();
    if (retry) {
      img.dataset.fallbackTried = '';
      state.loadedImages.delete(key);
    }
    img.src = retry ? cacheBustUrl(url) : url;
  };

  img.onload = markLoaded;
  img.onerror = () => {
    const fallback = localAssetUrl('image', e);
    if (fallback && fallback !== img.src && img.dataset.fallbackTried !== '1') {
      img.dataset.fallbackTried = '1';
      img.src = fallback;
      return;
    }
    markError();
  };

  markLoading();
  if (state.loadedImages.has(key)) load();
  else node._imageTimer = window.setTimeout(load, IMAGE_LOAD_DELAY);

  if (retryBtn) {
    retryBtn.onclick = ev => {
      ev.stopPropagation();
      load(true);
    };
  }
  wrap.querySelector('.zoom-btn').onclick = ev => {
    ev.stopPropagation();
    openLightbox(e, 0, wrap.querySelector('.card-img'));
  };
}

function cacheBustUrl(url) {
  if (!url) return url;
  return `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`;
}

function notifyImageLoadError(e) {
  const key = `image:${state.codex?.id || ''}`;
  if (state.sourceNoticesShown.has(key)) return;
  state.sourceNoticesShown.add(key);
  toast(`有图片加载失败，可在卡片上点击重试：${e.title}`);
}

function cleanupCard(node) {
  if (node._imageTimer) {
    clearTimeout(node._imageTimer);
    node._imageTimer = 0;
  }
}

function imageKey(e, url) {
  return `${state.codex.id}:${e.id}:${e.assetRev || ''}:${url}`;
}

function scheduleRelayout(animate = true) {
  relayoutQueuedAnimate = relayoutQueuedAnimate || animate;
  if (relayoutTimer) return;
  const now = performance.now();
  const delay = Math.max(0, RELAYOUT_INTERVAL - (now - lastRelayoutAt));
  relayoutTimer = window.setTimeout(() => {
    relayoutTimer = 0;
    lastRelayoutAt = performance.now();
    relayoutVisible({ animate: relayoutQueuedAnimate });
    relayoutQueuedAnimate = false;
  }, delay);
}

function startRelayoutAnimation() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const m = $('#masonry');
  if (!m) return;
  relayoutAnimating = true;
  m.classList.add('is-relayouting');
  // Make sure the transition class is active before the new transforms land.
  void m.offsetWidth;
  clearTimeout(relayoutAnimTimer);
  relayoutAnimTimer = window.setTimeout(() => {
    relayoutAnimating = false;
    m.classList.remove('is-relayouting');
    updateVirtualCards(true);
  }, RELAYOUT_ANIM_MS + 80);
}

function relayoutVisible({ animate = false } = {}) {
  if (!state.codex) return;
  if (animate) startRelayoutAnimation();
  computeLayout();
  updateVirtualCards(true);
}

/* ---------------- 复制 ---------------- */
async function copyEntry(e, node) {
  recordRecentEntry(e);
  saveBrowseStateNow();
  return copyText(e.tags, `已复制：${e.title}`, node);
}

/* NAI → SD 权重格式转换：NAI 每层括号 ×1.05 / ÷1.05。
   {tag}→(tag:1.05)  {{tag}}→(tag:1.103)  [tag]→(tag:0.952)  1.3::tag::→(tag:1.3)
   支持嵌套；真正未闭合的左括号只丢弃括号本身，避免把后续普通 tag 无声扩大加权。 */
const NAI_WEIGHT_BASE = 1.05;
function fmtSdWeight(w) { return parseFloat(w.toFixed(3)).toString(); }
function naiToSd(text) {
  if (!text) return text;
  const n = text.length;

  const readRun = (pos, ch) => {
    let cnt = 0;
    while (text[pos + cnt] === ch) cnt++;
    return cnt;
  };
  const cleanWeightContent = value => value.trim().replace(/[,\s，]+$/, '').trim();

  const parseNumericWeight = pos => {
    const ch = text[pos];
    if (ch !== '-' && ch !== '+' && (ch < '0' || ch > '9')) return null;
    const empty = text.slice(pos).match(/^([+-]?\d+(?:\.\d+)?)::(?=[,\n]|$)/);
    if (empty) return { out: '', pos: pos + empty[0].length };
    const m = text.slice(pos).match(/^([+-]?\d+(?:\.\d+)?)::([\s\S]*?)::/)
      || text.slice(pos).match(/^([+-]?\d+(?:\.\d+)?)::([^,\n]*)/);
    if (!m) return null;
    const content = naiToSd(cleanWeightContent(m[2]));
    if (!content) return { out: '', pos: pos + m[0].length };
    return {
      out: '(' + content + ':' + fmtSdWeight(parseFloat(m[1])) + ')',
      pos: pos + m[0].length
    };
  };

  const parseRange = (pos, stopClose = '') => {
    let out = '';
    while (pos < n) {
      const ch = text[pos];

      if (stopClose && ch === stopClose) {
        const closeCount = readRun(pos, stopClose);
        return { out, closeStart: pos, pos: pos + closeCount, closed: true, closeCount };
      }

      if (ch === '}' || ch === ']') {
        pos += readRun(pos, ch);
        continue;
      }

      const weighted = parseNumericWeight(pos);
      if (weighted) {
        out += weighted.out;
        pos = weighted.pos;
        continue;
      }

      if (ch === '{' || ch === '[') {
        const group = parseBracketWeight(pos);
        out += group.out;
        pos = group.pos;
        continue;
      }

      out += ch;
      pos++;
    }
    return { out, closeStart: pos, pos, closed: false, closeCount: 0 };
  };

  const parseBracketWeight = pos => {
    const open = text[pos];
    const close = open === '{' ? '}' : ']';
    const openCount = readRun(pos, open);
    const inner = parseRange(pos + openCount, close);
    if (!inner.closed) {
      return { out: inner.out, pos: inner.pos };
    }

    const matchedCount = Math.min(openCount, inner.closeCount);
    const nextPos = inner.closeStart + matchedCount;
    const content = cleanWeightContent(inner.out);
    if (!matchedCount || !content) {
      return { out: '', pos: nextPos };
    }
    const dir = open === '{' ? 1 : -1;
    return {
      out: '(' + content + ':' + fmtSdWeight(Math.pow(NAI_WEIGHT_BASE, dir * matchedCount)) + ')',
      pos: nextPos
    };
  };

  return parseRange(0).out;
}

async function copyText(text, message, node) {
  if (state.sdMode) {
    text = naiToSd(text);
    message += '（SD 格式）';
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  if (node) {
    node.classList.add('copied');
    setTimeout(() => node.classList.remove('copied'), 600);
  }
  toast(message);
}

function combinedPrompt(e) {
  return e.negative ? `${e.tags}\n\nNegative:\n${e.negative}` : e.tags;
}

let toastTimer;
function toast(msg, icon = '✓') {
  const t = $('#toast');
  t.textContent = icon ? `${icon} ${msg}` : msg;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------------- 浏览记录 ---------------- */
function saveRecentEntries() {
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(state.recentEntries));
}

function recordRecentEntry(e) {
  if (!state.codex || !e) return;
  const key = `${state.codex.id}:${e.id}`;
  const item = {
    codexId: state.codex.id,
    codexTitle: state.codex.title,
    entryId: e.id,
    title: e.title,
    path: e.path || [],
    thumb: hasEntryImage(e) ? thumbUrl(e) : '',
    at: Date.now(),
  };
  state.recentEntries = [
    item,
    ...state.recentEntries.filter(old => `${old.codexId}:${old.entryId}` !== key),
  ].slice(0, RECENT_ENTRY_LIMIT);
  saveRecentEntries();
}

let browseSaveTimer = 0;
function currentBrowseSnapshot(entryId = state.lightbox.entry?.id || '') {
  if (!state.codex) return null;
  return {
    codexId: state.codex.id,
    codexTitle: state.codex.title,
    path: state.activePath || [],
    q: state.query.trim(),
    onlyImaged: Boolean(state.onlyImaged),
    onlyFav: Boolean(state.onlyFav),
    entryId,
    scrollY: Math.max(0, Math.round(window.scrollY || 0)),
    at: Date.now(),
  };
}

function saveBrowseStateNow(entryId) {
  const snapshot = currentBrowseSnapshot(entryId);
  if (!snapshot) return;
  state.lastBrowse = snapshot;
  localStorage.setItem(LAST_BROWSE_STORAGE_KEY, JSON.stringify(snapshot));
}

function scheduleBrowseStateSave(entryId) {
  clearTimeout(browseSaveTimer);
  browseSaveTimer = window.setTimeout(() => saveBrowseStateNow(entryId), 180);
}

function browseDesc(snapshot) {
  if (!snapshot) return '暂无可恢复的位置';
  if (snapshot.q) return `${snapshot.codexTitle} · 搜索 “${snapshot.q}”`;
  if (snapshot.path?.length) return `${snapshot.codexTitle} · ${snapshot.path.join(' › ')}`;
  return `${snapshot.codexTitle} · ${formatRecentTime(snapshot.at)}`;
}

function formatRecentTime(ts) {
  const diff = Math.max(0, Date.now() - Number(ts || 0));
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(Number(ts)).toLocaleDateString('zh-CN');
}

function renderHistoryPanel() {
  const resume = $('#resumeBrowse');
  const resumeDesc = $('#resumeDesc');
  if (resumeDesc) resumeDesc.textContent = browseDesc(state.lastBrowse);
  if (resume) resume.disabled = !state.lastBrowse;
  const clearBtn = $('#clearRecent');
  if (clearBtn) clearBtn.disabled = state.recentEntries.length === 0;

  const list = $('#recentList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.recentEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = '最近还没有打开过词条。点卡片放大图或复制词条后，这里会自动记录。';
    list.appendChild(empty);
    return;
  }
  for (const item of state.recentEntries) {
    const btn = document.createElement('button');
    btn.className = 'recent-item';
    btn.type = 'button';
    btn.dataset.codex = item.codexId;
    btn.dataset.entry = item.entryId;

    if (item.thumb) {
      const img = document.createElement('img');
      img.className = 'recent-thumb';
      img.src = item.thumb;
      img.alt = '';
      btn.appendChild(img);
    } else {
      const mark = document.createElement('span');
      mark.className = 'recent-thumb no-img';
      mark.textContent = '☆';
      btn.appendChild(mark);
    }

    const main = document.createElement('span');
    main.className = 'recent-main';
    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = item.title;
    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    meta.textContent = `${item.codexTitle}${item.path?.length ? ' · ' + item.path.join(' › ') : ''}`;
    main.append(title, meta);
    btn.appendChild(main);

    const time = document.createElement('span');
    time.className = 'recent-time';
    time.textContent = formatRecentTime(item.at);
    btn.appendChild(time);
    btn.onclick = () => document.dispatchEvent(new CustomEvent('openRecentEntry', { detail: item }));
    list.appendChild(btn);
  }
}

function applyBrowseControls(snapshot) {
  state.onlyImaged = Boolean(snapshot.onlyImaged);
  state.onlyFav = Boolean(snapshot.onlyFav);
  const onlyImaged = $('#onlyImaged');
  const onlyFav = $('#onlyFav');
  if (onlyImaged) onlyImaged.checked = state.onlyImaged;
  if (onlyFav) onlyFav.checked = state.onlyFav;
}

function applyBrowseState(snapshot) {
  state.activePath = snapshot.path || [];
  state.query = snapshot.q || '';
  const search = $('#search');
  if (search) search.value = state.query;
  updateSearchClear();
  renderTree();
  applyFilter({ resetScroll: true });
  syncUrlState({ replace: true, entry: snapshot.entryId || '' });
}

async function resumeLastBrowse() {
  const snapshot = state.lastBrowse;
  if (!snapshot) return;
  const meta = state.codexes.find(c => c.id === snapshot.codexId);
  if (meta && isCodexLocked(meta)) {
    showNsfwLockedHint();
    return;
  }
  applyBrowseControls(snapshot);
  if (!state.codex || state.codex.id !== snapshot.codexId) {
    await loadCodex(snapshot.codexId, {
      urlState: { codex: snapshot.codexId, path: snapshot.path || [], q: snapshot.q || '', entry: snapshot.entryId || '' },
      replaceUrl: true,
    });
  } else {
    applyBrowseState(snapshot);
    if (snapshot.entryId) window.setTimeout(() => openEntryDeepLink(snapshot.entryId), 120);
  }
  if (!snapshot.entryId) {
    window.setTimeout(() => {
      window.scrollTo({ top: snapshot.scrollY || 0, left: 0, behavior: 'auto' });
      updateVirtualCards(true);
      updateScrollProgress();
    }, 120);
  }
  toast('已恢复上次浏览位置');
}

async function openRecentEntry(item) {
  if (!item?.codexId || !item.entryId) return;
  const meta = state.codexes.find(c => c.id === item.codexId);
  if (meta && isCodexLocked(meta)) {
    showNsfwLockedHint();
    return;
  }
  const urlState = { codex: item.codexId, path: item.path || [], q: '', entry: item.entryId };
  if (!state.codex || state.codex.id !== item.codexId) {
    state.onlyFav = false;
    state.onlyImaged = false;
    applyBrowseControls({ onlyFav: false, onlyImaged: false });
    await loadCodex(item.codexId, { urlState, replaceUrl: true });
  } else {
    state.query = '';
    state.activePath = item.path || [];
    state.onlyFav = false;
    state.onlyImaged = false;
    applyBrowseControls({ onlyFav: false, onlyImaged: false });
    const search = $('#search');
    if (search) search.value = '';
    updateSearchClear();
    renderTree();
    applyFilter({ resetScroll: true });
    syncUrlState({ replace: true, entry: item.entryId });
    window.setTimeout(() => openEntryDeepLink(item.entryId), 120);
  }
}

/* ---------------- 收藏 ---------------- */
function favKey(e) { return state.codex.id + ':' + e.id; }
function toggleFav(e, btn) {
  const k = favKey(e);
  if (state.favs.has(k)) state.favs.delete(k); else state.favs.add(k);
  localStorage.setItem('fadian-favs', JSON.stringify([...state.favs]));
  const on = state.favs.has(k);
  if (btn) {
    btn.textContent = on ? '★' : '☆';
    btn.classList.toggle('on', on);
    btn.title = on ? '取消收藏' : '收藏';
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
  }
  if (state.onlyFav) applyFilter({ resetScroll: true });
  toast(on ? `已收藏：${e.title}` : `已取消收藏：${e.title}`);
}

/* ---------------- 灯箱（沉浸浮影 + 原位展开） ---------------- */
let lbSeq = 0;
let lbCloseTimer = 0;
let lbSourceImg = null;
let lbFocusReturn = null;
const lbPreloadCache = new Set();

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function applyFlyRect(el, rect, radius) {
  el.style.left = rect.left + 'px';
  el.style.top = rect.top + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
  el.style.borderRadius = radius + 'px';
}

function makeFlyClone(src, rect) {
  const clone = document.createElement('img');
  clone.className = 'lb-fly';
  clone.alt = '';
  clone.decoding = 'sync';
  clone.loading = 'eager';
  clone.src = src;
  applyFlyRect(clone, rect, 14);
  document.body.appendChild(clone);
  void clone.offsetWidth;
  return clone;
}

function clearFlyClones() {
  document.querySelectorAll('.lb-fly').forEach(n => n.remove());
}

function removeFlyCloneAfterPaint(clone) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => clone.remove());
  });
}

function fitStageRect(ratio) {
  const box = $('#lightboxStage').getBoundingClientRect();
  if (!box.width || !box.height) return { left: 0, top: 0, width: 0, height: 0 };
  let w = box.width;
  let h = ratio > 0 ? w / ratio : box.height;
  if (h > box.height) {
    h = box.height;
    w = h * ratio;
  }
  return {
    left: box.left + (box.width - w) / 2,
    top: box.top + (box.height - h) / 2,
    width: w,
    height: h,
  };
}

function resolvedUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, location.href).href;
  } catch {
    return String(url);
  }
}

function flyIn(sourceEl) {
  const lb = $('#lightbox');
  const from = sourceEl.getBoundingClientRect();
  if (!from.width || !from.height) return;
  const ratio = sourceEl.naturalWidth / sourceEl.naturalHeight;
  const target = fitStageRect(ratio);
  if (!target.width) return;
  lb.classList.add('flying');
  const clone = makeFlyClone(sourceEl.currentSrc || sourceEl.src, from);
  requestAnimationFrame(() => applyFlyRect(clone, target, 14));
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    lb.classList.remove('flying');
    removeFlyCloneAfterPaint(clone);
  };
  clone.addEventListener('transitionend', finish, { once: true });
  window.setTimeout(finish, 480);
}

function openLightbox(entry, index = 0, sourceEl = null) {
  const images = entryImages(entry);
  if (!images.length) return;
  recordRecentEntry(entry);
  state.lightbox = {
    entry,
    images,
    index: clamp(index, 0, images.length - 1),
  };
  lbSourceImg = sourceEl && sourceEl.tagName === 'IMG' ? sourceEl : null;
  const lb = $('#lightbox');
  clearTimeout(lbCloseTimer);
  clearFlyClones();
  lb.classList.remove('flying');
  lb.classList.toggle('folded', localStorage.getItem('fadian-lbinfo') === 'folded');
  lb.classList.toggle('has-thumbs', images.length > 1);
  lb.hidden = false;
  renderLightbox();
  void lb.offsetWidth;
  lb.classList.add('is-open');
  syncUrlState({ entry: entry.id });
  lbFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  window.setTimeout(() => $('#lightboxClose')?.focus(), 0);
  if (lbSourceImg && lbSourceImg.naturalWidth && !prefersReducedMotion()) flyIn(lbSourceImg);
}

function closeLightbox() {
  const lb = $('#lightbox');
  if (lb.hidden) return;
  syncUrlState({ entry: '' });
  lbSeq++;
  clearTimeout(lbCloseTimer);
  const done = () => {
    lb.hidden = true;
    lb.classList.remove('is-open', 'flying');
    clearFlyClones();
    const img = $('#lightboxImg');
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
    state.lightbox = { entry: null, images: [], index: 0 };
    lbSourceImg = null;
    if (lbFocusReturn?.isConnected) lbFocusReturn.focus();
    lbFocusReturn = null;
  };
  if (prefersReducedMotion()) {
    lb.classList.remove('is-open');
    done();
    return;
  }
  const img = $('#lightboxImg');
  const src = lbSourceImg;
  const flying = lb.classList.contains('flying');
  lb.classList.remove('is-open');
  if (!flying && src && src.isConnected && img.naturalWidth) {
    const from = img.getBoundingClientRect();
    const to = src.getBoundingClientRect();
    if (from.width && to.width && to.bottom > -40 && to.top < window.innerHeight + 40) {
      const clone = makeFlyClone(img.currentSrc || img.src, from);
      lb.classList.add('flying');
      requestAnimationFrame(() => applyFlyRect(clone, to, 12));
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        done();
      };
      clone.addEventListener('transitionend', finish, { once: true });
      lbCloseTimer = window.setTimeout(finish, 460);
      return;
    }
  }
  lbCloseTimer = window.setTimeout(done, 270);
}

function stepLightbox(delta) {
  const lb = state.lightbox;
  if (!lb.entry || lb.images.length < 2) return;
  lb.index = (lb.index + delta + lb.images.length) % lb.images.length;
  renderLightbox();
}

function preloadImage(url) {
  if (!url || lbPreloadCache.has(url)) return;
  lbPreloadCache.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

function preloadLightboxNeighbors() {
  const lb = state.lightbox;
  const e = lb.entry;
  if (!e || lb.images.length < 2) return;
  const indexes = [
    (lb.index - 1 + lb.images.length) % lb.images.length,
    (lb.index + 1) % lb.images.length,
  ];
  for (const i of [...new Set(indexes)]) {
    const item = lb.images[i];
    preloadImage(imageItemUrl('image', e, item));
    preloadImage(imageItemUrl('original', e, item));
  }
}

function renderLightbox() {
  const lb = state.lightbox;
  const e = lb.entry;
  const item = lb.images[lb.index];
  if (!e || !item) return;
  const seq = ++lbSeq;
  const img = $('#lightboxImg');
  const thumbSrc = imageItemUrl('image', e, item);
  const origSrc = imageItemUrl('original', e, item);
  const origAbs = resolvedUrl(origSrc);
  img.onload = null;
  img.onerror = () => {
    if (seq !== lbSeq) return;
    if (origSrc && resolvedUrl(img.currentSrc || img.src) !== origAbs) {
      img.src = origSrc;
      return;
    }
    notifyImageLoadError(e);
  };
  /* 垫底加载：先上缩略图，原图加载完成后替换 */
  const showImage = () => {
    if (seq !== lbSeq) return;
    img.src = thumbSrc || origSrc;
    if (origSrc && origSrc !== thumbSrc) {
      const pre = new Image();
      pre.onload = () => {
        if (seq === lbSeq && state.lightbox.entry === e) img.src = origSrc;
      };
      pre.src = origSrc;
    }
  };
  showImage();

  $('#lightboxTitle').textContent = e.title;
  $('#lightboxMeta').textContent = `${lb.index + 1} / ${lb.images.length} · ${e.path.join(' › ')}`;

  const credit = item.credit || item.author || e.credit || e.author || '';
  const creditUrl = item.creditUrl || item.authorUrl || e.creditUrl || e.authorUrl || '';
  const creditEl = $('#lightboxCredit');
  if (credit) {
    creditEl.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5 20a7 7 0 0 1 14 0"/></svg>' +
      `<span>${esc(credit)}</span>`;
    if (creditUrl) { creditEl.href = creditUrl; creditEl.target = '_blank'; creditEl.rel = 'noopener'; }
    else creditEl.removeAttribute('href');
    creditEl.hidden = false;
  } else {
    creditEl.hidden = true;
    creditEl.removeAttribute('href');
  }

  renderHighlightedText($('#lightboxTags'), e.tags || '', currentHighlightTerms());
  $('#lightboxNegative').textContent = e.negative || '';
  $('#lightboxNote').textContent = e.note || '';
  $('#negativeBlock').hidden = !e.negative;
  $('#noteBlock').hidden = !e.note;

  $('#copyPositive').onclick = ev => { ev.stopPropagation(); copyText(e.tags, `已复制正向：${e.title}`); };
  $('#copyNegative').hidden = !e.negative;
  $('#copyNegative').onclick = ev => { ev.stopPropagation(); copyText(e.negative, `已复制负面：${e.title}`); };
  $('#copyAll').hidden = !e.negative;
  $('#copyAll').onclick = ev => { ev.stopPropagation(); copyText(combinedPrompt(e), `已复制正向+负面：${e.title}`); };
  $('#copyRawTag').hidden = !item.rawTag;
  $('#copyRawTag').onclick = ev => { ev.stopPropagation(); copyText(item.rawTag, `已复制当前图 raw tag：${e.title}`); };
  const actions = document.querySelector('.lightbox-actions');
  if (actions) actions.hidden = $('#copyAll').hidden && $('#copyRawTag').hidden;

  const prev = $('#lightboxPrev');
  const next = $('#lightboxNext');
  prev.hidden = next.hidden = lb.images.length < 2;
  const thumbs = $('#lightboxThumbs');
  thumbs.innerHTML = '';
  thumbs.hidden = lb.images.length < 2;
  if (!thumbs.hidden) {
    lb.images.forEach((image, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lightbox-thumb' + (i === lb.index ? ' active' : '');
      btn.title = `第 ${i + 1} 张`;
      const ti = document.createElement('img');
      ti.alt = '';
      ti.loading = 'lazy';
      ti.src = imageItemUrl('image', e, image) || imageItemUrl('original', e, image);
      btn.appendChild(ti);
      btn.onclick = ev => {
        ev.stopPropagation();
        if (lb.index === i) return;
        lb.index = i;
        renderLightbox();
      };
      thumbs.appendChild(btn);
    });
    const act = thumbs.querySelector('.lightbox-thumb.active');
    if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  preloadLightboxNeighbors();
}

function isLocalOrigin() {
  return ['localhost', '127.0.0.1', '::1'].includes(location.hostname) || location.protocol === 'file:';
}

function mediaPath(kind, e) {
  const file = kind === 'original' ? e.original : e.image;
  if (!file) return '';
  if (isAbsoluteUrl(file)) return file;
  if (state.codex.assetPathMode === 'relative') {
    return encodeAssetPath(file);
  }
  const prefix = kind === 'original' ? state.media.originalPrefix : state.media.imagePrefix;
  const assetCodexId = e.assetCodexId || state.codex.id;
  return [prefix || (kind === 'original' ? 'originals' : 'images'), assetCodexId, file]
    .map(part => encodeURIComponent(part).replace(/%2F/g, '/'))
    .join('/');
}

function imageItemPath(kind, e, item) {
  const file = kind === 'original' ? (item.original || item.path) : item.path;
  if (!file) return '';
  if (isAbsoluteUrl(file)) return file;
  if (state.codex.assetPathMode === 'relative') return encodeAssetPath(file);
  return mediaPath(kind, { ...e, image: item.path, original: item.original || item.path });
}

function entryImages(e) {
  return (e.images && e.images.length)
    ? e.images
    : (e.image ? [{ path: e.image, original: e.original || e.image }] : []);
}

function isAbsoluteUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) || String(url || '').startsWith('data:');
}

function encodeAssetPath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function withRev(url, e) {
  if (!url || !e.assetRev) return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(e.assetRev);
}

function localAssetUrl(kind, e) {
  if (state.codex.assetPathMode === 'relative') return '';
  return withRev(mediaPath(kind, e), e);
}

function assetUrl(kind, e) {
  const path = mediaPath(kind, e);
  if (!path) return '';
  if (isAbsoluteUrl(path)) return withRev(path, e);
  if (state.codex.assetPathMode === 'relative') {
    const base = state.codex.assetBaseUrl;
    return withRev(base ? `${base}/${path}` : path, e);
  }
  if (isLocalOrigin() && state.media.localFallback !== false) return withRev(path, e);
  const base = String(state.media.baseUrl || '').replace(/\/+$/, '');
  return withRev(base ? `${base}/${path}` : path, e);
}

function imageItemUrl(kind, e, item) {
  const path = imageItemPath(kind, e, item);
  if (!path) return '';
  if (isAbsoluteUrl(path)) return withRev(path, e);
  if (state.codex.assetPathMode === 'relative') {
    const base = state.codex.assetBaseUrl;
    return withRev(base ? `${base}/${path}` : path, e);
  }
  return assetUrl(kind, { ...e, image: item.path, original: item.original || item.path });
}

function thumbUrl(e) {
  return assetUrl('image', e);
}

function originalUrl(e) {
  return assetUrl('original', e);
}

/* ---------------- 交互绑定 ---------------- */
function bindUI() {
  let st;
  const searchInput = $('#search');
  const searchClear = $('#searchClear');
  const searchExit = $('#searchExit');
  const mobileSearchBtn = $('#mobileSearchBtn');
  const mobileQuery = window.matchMedia('(max-width:600px)');
  const setSearchMode = (on, { focus = false, restoreButton = false } = {}) => {
    const shouldOpen = on && mobileQuery.matches;
    document.body.classList.toggle('search-mode', shouldOpen);
    if (shouldOpen) {
      setTopbarHidden(false);
      if (focus) requestAnimationFrame(() => searchInput.focus());
    } else {
      searchInput.blur();
      if (restoreButton) mobileSearchBtn?.focus();
    }
  };
  mobileSearchBtn?.addEventListener('click', () => setSearchMode(true, { focus: true }));
  searchExit?.addEventListener('click', () => setSearchMode(false, { restoreButton: true }));
  if (mobileQuery.addEventListener) {
    mobileQuery.addEventListener('change', ev => {
      if (!ev.matches) setSearchMode(false);
    });
  }
  searchInput.oninput = e => {
    updateSearchClear();
    clearTimeout(st);
    st = setTimeout(() => {
      state.query = e.target.value;
      if (state.query.trim()) {
        document.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
      } else {
        renderTree();
      }
      applyFilter({ resetScroll: true });
      syncUrlState();
    }, 180);
  };
  if (searchClear) {
    searchClear.onclick = () => {
      if (!searchInput.value) return;
      clearTimeout(st);
      searchInput.value = '';
      state.query = '';
      updateSearchClear();
      renderTree();
      applyFilter({ resetScroll: true });
      syncUrlState();
      searchInput.focus();
    };
  }

  $('#onlyImaged').onchange = e => { state.onlyImaged = e.target.checked; applyFilter({ resetScroll: true }); };
  $('#onlyFav').onchange = e => { state.onlyFav = e.target.checked; applyFilter({ resetScroll: true }); };

  const applyTheme = d => {
    document.body.classList.toggle('dark', d);
    $('#themeBtn').innerHTML = d ? THEME_ICONS.sun : THEME_ICONS.moon;
    $('#themeBtn').setAttribute('aria-label', d ? '切换浅色模式' : '切换深色模式');
    localStorage.setItem('fadian-dark', d ? '1' : '0');
  };
  $('#themeBtn').onclick = () => applyTheme(!document.body.classList.contains('dark'));
  applyTheme(localStorage.getItem('fadian-dark') === '1');

  /* SD 复制模式：设置里的开关 + 顶栏常驻角标（开着才显示，点角标可关），状态存 localStorage */
  const sdToggle = $('#sdModeToggle');
  const sdBadge = $('#sdBadge');
  let sdBadgeTimer;
  const showSdBadge = (on, animate) => {
    if (!sdBadge) return;
    clearTimeout(sdBadgeTimer);
    if (on) {
      sdBadge.hidden = false;
      if (animate) void sdBadge.offsetWidth;   // 强制回流，让淡入过渡生效
      sdBadge.classList.add('show');
    } else {
      sdBadge.classList.remove('show');
      if (animate && !prefersReducedMotion()) {
        sdBadgeTimer = setTimeout(() => { sdBadge.hidden = true; }, 240);  // 等淡出动画结束再收起占位
      } else {
        sdBadge.hidden = true;
      }
    }
  };
  const applySdMode = (on, animate = true) => {
    state.sdMode = on;
    if (sdToggle) sdToggle.checked = on;
    document.body.classList.toggle('sd-mode', on);
    localStorage.setItem('fadian-sdmode', on ? '1' : '0');
    showSdBadge(on, animate);
  };
  if (sdToggle) sdToggle.onchange = e => applySdMode(e.target.checked);
  if (sdBadge) sdBadge.onclick = () => applySdMode(false);
  applySdMode(localStorage.getItem('fadian-sdmode') === '1', false);  // 初始化不做动画

  for (const btn of document.querySelectorAll('[data-density]')) {
    btn.onclick = () => applyDensity(btn.dataset.density, { render: true, announce: true });
  }
  updateDensityControls();

  const sidebar = $('#sidebar');
  const savedSidebar = localStorage.getItem('fadian-sidebar');
  if (savedSidebar === 'closed' || (savedSidebar === null && window.innerWidth <= 600)) {
    sidebar.classList.add('closed');
  }
  $('#menuBtn').onclick = () => {
    sidebar.classList.toggle('closed');
    localStorage.setItem('fadian-sidebar', sidebar.classList.contains('closed') ? 'closed' : 'open');
  };

  const moreBtn = $('#moreBtn');
  const moreMenu = $('#moreMenu');
  const moreItems = () => [...moreMenu.querySelectorAll('.more-item')];
  const closeMore = ({ focusButton = false } = {}) => {
    if (!moreMenu || moreMenu.hidden) return;
    moreMenu.hidden = true;
    moreBtn.classList.remove('open');
    moreBtn.setAttribute('aria-expanded', 'false');
    if (focusButton) moreBtn.focus();
  };
  const openMore = ({ focus = false } = {}) => {
    closeBannerAbout();
    moreMenu.hidden = false;
    moreBtn.classList.add('open');
    moreBtn.setAttribute('aria-expanded', 'true');
    if (focus) requestAnimationFrame(() => moreItems()[0]?.focus());
  };
  if (moreBtn && moreMenu) {
    moreBtn.onclick = ev => {
      ev.stopPropagation();
      if (moreMenu.hidden) openMore({ focus: true });
      else closeMore({ focusButton: true });
    };
    moreBtn.onkeydown = ev => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      openMore({ focus: true });
    };
    moreMenu.onkeydown = ev => {
      const list = moreItems();
      const i = list.indexOf(document.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); closeMore({ focusButton: true }); }
      else if (ev.key === 'Tab') closeMore();
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); list[(i + 1 + list.length) % list.length]?.focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); list[0]?.focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); list[list.length - 1]?.focus(); }
    };
    document.addEventListener('click', ev => {
      if (!moreMenu.hidden && !moreMenu.contains(ev.target) && !moreBtn.contains(ev.target)) closeMore();
    });
  }

  /* 设置 / 关于 悬浮框：开关三件套（按钮/遮罩/Esc），带淡入淡出 */
  const settingsMask = $('#settings');
  const nsfwMask = $('#nsfwConfirm');
  const shortcutMask = $('#shortcutHelp');
  const historyMask = $('#historyPanel');
  const aboutMask = $('#about');
  const archiveMask = $('#codexArchive');
  const maskTimers = new WeakMap();
  const maskOpeners = new WeakMap();
  const focusableIn = root => [...root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null || el === document.activeElement);
  const focusFirstIn = root => requestAnimationFrame(() => focusableIn(root)[0]?.focus());
  const trapFocus = (ev, root) => {
    if (ev.key !== 'Tab') return;
    const list = focusableIn(root);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  };
  const openMask = (mask, trigger = document.activeElement) => {
    clearTimeout(maskTimers.get(mask));
    if (trigger instanceof HTMLElement) maskOpeners.set(mask, trigger);
    mask.hidden = false;
    void mask.offsetWidth;            // 强制回流，让淡入过渡生效
    mask.classList.add('show');
    focusFirstIn(mask);
  };
  const closeMask = mask => {
    mask.classList.remove('show');
    const restoreFocus = () => {
      const opener = maskOpeners.get(mask);
      if (opener?.isConnected) opener.focus();
    };
    if (prefersReducedMotion()) { mask.hidden = true; restoreFocus(); return; }
    maskTimers.set(mask, setTimeout(() => {
      if (!mask.classList.contains('show')) {
        mask.hidden = true;   // 期间未被重新打开才真正收起
        restoreFocus();
      }
    }, 240));
  };
  const nsfwToggle = $('#nsfwToggle');
  const setNsfwAccess = (on, { announce = false } = {}) => {
    state.allowNsfw = Boolean(on);
    document.body.classList.toggle('nsfw-unlocked', state.allowNsfw);
    localStorage.setItem(NSFW_STORAGE_KEY, state.allowNsfw ? '1' : '0');
    if (nsfwToggle) nsfwToggle.checked = state.allowNsfw;
    updateCodexPickerState();
    if (!state.allowNsfw && isNsfwCodex(state.codex)) {
      const fallback = firstUnlockedCodex();
      if (fallback) loadCodex(fallback.id, { replaceUrl: true });
    }
    if (announce) toast(state.allowNsfw ? 'NSFW 法典已解锁' : 'NSFW 法典已锁定');
  };
  const cancelNsfwConfirm = () => {
    if (nsfwToggle) nsfwToggle.checked = false;
    closeMask(nsfwMask);
  };
  if (nsfwToggle) {
    nsfwToggle.checked = state.allowNsfw;
    nsfwToggle.onchange = e => {
      if (e.target.checked) {
        e.target.checked = false;
        openMask(nsfwMask, nsfwToggle);
      } else {
        setNsfwAccess(false, { announce: true });
      }
    };
  }
  $('#nsfwAccept').onclick = () => {
    setNsfwAccess(true, { announce: true });
    closeMask(nsfwMask);
  };
  $('#nsfwCancel').onclick = cancelNsfwConfirm;
  $('#nsfwCancelX').onclick = cancelNsfwConfirm;
  nsfwMask.onclick = ev => { if (ev.target === nsfwMask) cancelNsfwConfirm(); };
  nsfwMask.onkeydown = ev => trapFocus(ev, nsfwMask);
  $('#shortcutBtn').onclick = () => { closeMore(); openMask(shortcutMask, moreBtn); };
  $('#shortcutClose').onclick = () => closeMask(shortcutMask);
  shortcutMask.onclick = ev => { if (ev.target === shortcutMask) closeMask(shortcutMask); };
  shortcutMask.onkeydown = ev => trapFocus(ev, shortcutMask);
  $('#historyBtn').onclick = () => { closeMore(); renderHistoryPanel(); openMask(historyMask, moreBtn); };
  $('#historyClose').onclick = () => closeMask(historyMask);
  historyMask.onclick = ev => { if (ev.target === historyMask) closeMask(historyMask); };
  historyMask.onkeydown = ev => trapFocus(ev, historyMask);
  $('#resumeBrowse').onclick = async () => {
    closeMask(historyMask);
    await resumeLastBrowse();
  };
  $('#clearRecent').onclick = () => {
    state.recentEntries = [];
    saveRecentEntries();
    renderHistoryPanel();
  };
  document.addEventListener('openRecentEntry', async ev => {
    closeMask(historyMask);
    await openRecentEntry(ev.detail);
  });
  $('#settingsBtn').onclick = () => { closeMore(); openMask(settingsMask, moreBtn); };
  $('#settingsClose').onclick = () => closeMask(settingsMask);
  settingsMask.onclick = ev => { if (ev.target === settingsMask) closeMask(settingsMask); };
  settingsMask.onkeydown = ev => trapFocus(ev, settingsMask);
  $('#aboutBtn').onclick = () => { closeMore(); openMask(aboutMask, moreBtn); };
  $('#aboutClose').onclick = () => closeMask(aboutMask);
  aboutMask.onclick = ev => { if (ev.target === aboutMask) closeMask(aboutMask); };
  aboutMask.onkeydown = ev => trapFocus(ev, aboutMask);
  $('#archiveClose').onclick = () => closeMask(archiveMask);
  archiveMask.onclick = ev => { if (ev.target === archiveMask) closeMask(archiveMask); };
  archiveMask.onkeydown = ev => trapFocus(ev, archiveMask);
  document.addEventListener('openCodexArchive', ev => {
    renderCodexArchive();
    const opener = document.querySelector('.banner-about-btn') || ev.detail?.trigger || document.activeElement;
    closeBannerAbout();
    openMask(archiveMask, opener);
  });
  document.addEventListener('click', ev => {
    const openBtn = document.querySelector('.banner-about-btn.open');
    const openPop = document.querySelector('.banner-pop:not([hidden])');
    if (!openBtn || !openPop) return;
    if (openBtn.contains(ev.target) || openPop.contains(ev.target)) return;
    closeBannerAbout();
  });
  window.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (document.body.classList.contains('search-mode')) {
      ev.preventDefault();
      setSearchMode(false, { restoreButton: true });
      return;
    }
    if (!nsfwMask.hidden) {
      ev.preventDefault();
      cancelNsfwConfirm();
      return;
    }
    closeMore({ focusButton: !moreMenu.hidden });
    if (!settingsMask.hidden) closeMask(settingsMask);
    if (!shortcutMask.hidden) closeMask(shortcutMask);
    if (!historyMask.hidden) closeMask(historyMask);
    if (!aboutMask.hidden) closeMask(aboutMask);
    if (!archiveMask.hidden) closeMask(archiveMask);
    closeBannerAbout();
  });
  let suppressLightboxClick = false;
  $('#lightbox').onclick = ev => {
    if (suppressLightboxClick) {
      suppressLightboxClick = false;
      return;
    }
    if (ev.target.id === 'lightbox' || ev.target.id === 'lightboxStage') closeLightbox();
  };
  $('#lightboxFold').onclick = ev => {
    ev.stopPropagation();
    const lbEl = $('#lightbox');
    lbEl.classList.toggle('folded');
    localStorage.setItem('fadian-lbinfo', lbEl.classList.contains('folded') ? 'folded' : 'open');
  };
  $('#lightboxClose').onclick = closeLightbox;
  $('#lightboxPrev').onclick = ev => { ev.stopPropagation(); stepLightbox(-1); };
  $('#lightboxNext').onclick = ev => { ev.stopPropagation(); stepLightbox(1); };
  let lightboxTouch = null;
  let lightboxPointer = null;
  let lastLightboxSwipeAt = 0;
  const canStartLightboxSwipe = target =>
    !target.closest('.lightbox-info,.lightbox-thumbs,.lb-circle,.lb-fold');
  const commitLightboxSwipe = (dx, dy, elapsed) => {
    if (state.lightbox.images.length < 2) return false;
    if (elapsed > 800 || Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.2) return false;
    stepLightbox(dx < 0 ? 1 : -1);
    lastLightboxSwipeAt = Date.now();
    suppressLightboxClick = true;
    window.setTimeout(() => { suppressLightboxClick = false; }, 80);
    return true;
  };
  $('#lightbox').addEventListener('touchstart', ev => {
    if ($('#lightbox').hidden || ev.touches.length !== 1) return;
    if (!canStartLightboxSwipe(ev.target)) return;
    const t = ev.touches[0];
    lightboxTouch = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  $('#lightbox').addEventListener('touchmove', ev => {
    if (!lightboxTouch || ev.touches.length !== 1) return;
    const t = ev.touches[0];
    const dx = t.clientX - lightboxTouch.x;
    const dy = t.clientY - lightboxTouch.y;
    if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.15) ev.preventDefault();
  }, { passive: false });
  $('#lightbox').addEventListener('touchend', ev => {
    if (!lightboxTouch) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - lightboxTouch.x;
    const dy = t.clientY - lightboxTouch.y;
    const elapsed = Date.now() - lightboxTouch.at;
    lightboxTouch = null;
    commitLightboxSwipe(dx, dy, elapsed);
  }, { passive: true });
  $('#lightbox').addEventListener('touchcancel', () => { lightboxTouch = null; }, { passive: true });
  $('#lightbox').addEventListener('pointerdown', ev => {
    if ($('#lightbox').hidden || ev.button !== 0) return;
    if (!mobileQuery.matches && ev.pointerType !== 'touch') return;
    if (!canStartLightboxSwipe(ev.target)) return;
    lightboxPointer = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, at: Date.now() };
  });
  $('#lightbox').addEventListener('pointermove', ev => {
    if (!lightboxPointer || ev.pointerId !== lightboxPointer.id) return;
    const dx = ev.clientX - lightboxPointer.x;
    const dy = ev.clientY - lightboxPointer.y;
    if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.15) ev.preventDefault();
  }, { passive: false });
  $('#lightbox').addEventListener('pointerup', ev => {
    if (!lightboxPointer || ev.pointerId !== lightboxPointer.id) return;
    const dx = ev.clientX - lightboxPointer.x;
    const dy = ev.clientY - lightboxPointer.y;
    const elapsed = Date.now() - lightboxPointer.at;
    lightboxPointer = null;
    if (Date.now() - lastLightboxSwipeAt < 220) return;
    commitLightboxSwipe(dx, dy, elapsed);
  });
  $('#lightbox').addEventListener('pointercancel', ev => {
    if (lightboxPointer?.id === ev.pointerId) lightboxPointer = null;
  });
  window.addEventListener('keydown', ev => {
    if ($('#lightbox').hidden) return;
    if (ev.key === 'Escape') closeLightbox();
    if (ev.key === 'ArrowLeft') stepLightbox(-1);
    if (ev.key === 'ArrowRight') stepLightbox(1);
  });

  window.addEventListener('scroll', scheduleVirtualUpdate, { passive: true });

  /* 智能顶栏：下滑隐藏、上滑立现；搜索聚焦/移动端目录打开时锁定不收 */
  const randomBtn = $('#randomBtn');
  const backTopBtn = $('#backTop');
  const floatActions = $('.float-actions');
  const setTopbarHidden = hide => document.body.classList.toggle('tb-hidden', hide);
  const scrollToTop = () => {
    setTopbarHidden(false);
    backTopBtn.classList.remove('show');
    floatActions?.classList.remove('has-backtop');
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    updateScrollProgress();
  };
  let lastScrollY = Math.max(0, window.scrollY);
  window.addEventListener('scroll', () => {
    const y = Math.max(0, window.scrollY);
    const dy = y - lastScrollY;
    lastScrollY = y;
    const showBackTop = y > 800;
    backTopBtn.classList.toggle('show', showBackTop);
    floatActions?.classList.toggle('has-backtop', showBackTop);
    updateScrollProgress();
    scheduleBrowseStateSave();
    if (Math.abs(dy) < 4) return;
    if (document.activeElement === searchInput) { setTopbarHidden(false); return; }
    if (mobileQuery.matches && !sidebar.classList.contains('closed')) { setTopbarHidden(false); return; }
    setTopbarHidden(dy > 0 && y > 120);
  }, { passive: true });
  searchInput.addEventListener('focus', () => {
    setTopbarHidden(false);
    if (mobileQuery.matches) document.body.classList.add('search-mode');
  });
  const typingTarget = () => {
    const el = document.activeElement;
    const tag = el && el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
  };
  const overlayOpen = () =>
    !$('#lightbox').hidden ||
    !settingsMask.hidden ||
    !nsfwMask.hidden ||
    !shortcutMask.hidden ||
    !historyMask.hidden ||
    !aboutMask.hidden ||
    !archiveMask.hidden;
  window.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || typingTarget()) return;
    if (ev.key === '?' && !overlayOpen()) {
      ev.preventDefault();
      openMask(shortcutMask);
      return;
    }
    if (ev.key.toLowerCase() === 'g' && !overlayOpen()) {
      ev.preventDefault();
      scrollToTop();
      return;
    }
    if (ev.key === '/' && !overlayOpen()) {
      ev.preventDefault();
      if (mobileQuery.matches) setSearchMode(true);
      searchInput.focus();
    }
  });

  /* 分类轨道：纵向滚轮转横向滚动 */
  const rail = $('#chipRail');
  if (rail) rail.addEventListener('wheel', ev => {
    if (!ev.deltaY) return;
    ev.preventDefault();
    rail.scrollLeft += ev.deltaY;
  }, { passive: false });

  backTopBtn.onclick = () => {
    scrollToTop();
  };
  if (randomBtn) {
    randomBtn.onclick = () => {
      setTopbarHidden(false);
      randomExplore();
    };
  }

  window.addEventListener('resize', () => {
    scheduleRelayout(true);
    updateScrollProgress();
  }, { passive: true });

  if ('ResizeObserver' in window) {
    let lastMainWidth = 0;
    const ro = new ResizeObserver(entries => {
      const width = Math.round(entries[0]?.contentRect?.width || 0);
      if (!width || Math.abs(width - lastMainWidth) < 2) return;
      lastMainWidth = width;
      scheduleRelayout(true);
    });
    ro.observe($('#main'));
  }
}

function updateSearchClear() {
  const btn = $('#searchClear');
  const input = $('#search');
  if (btn && input) btn.hidden = !input.value;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

init();
