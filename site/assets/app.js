'use strict';

const $ = (s, r = document) => r.querySelector(s);

const CODEX_R2_BASE = 'https://pub-a66b6b5ffa0d44a89eb7dd6fa1070b58.r2.dev';

const CARD_MIN_WIDTH = 290;
const GAP = 16;
const VIRTUAL_BUFFER_UP = 0.8;
const VIRTUAL_BUFFER_DOWN = 1.4;
const IMAGE_LOAD_DELAY = 90;
const RELAYOUT_INTERVAL = 90;
const RELAYOUT_ANIM_MS = 360;
const DEFAULT_IMAGE_RATIO = 1.18;
const MAX_TAG_LINES = 6;

const state = {
  codex: null,        // 当前法典数据
  list: [],           // 当前过滤后的词条
  rendered: 0,        // 当前虚拟渲染数量
  placements: [],     // 虚拟瀑布流布局
  nodes: new Map(),   // index -> DOM node
  colN: 0,
  itemWidth: 0,
  activePath: [],     // 选中的目录路径
  query: '',
  onlyImaged: false,
  onlyFav: false,
  favs: new Set(),    // 收藏集合，键为 codexId:entryId
  loadedImages: new Set(),
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
    state.favs = new Set(JSON.parse(localStorage.getItem('fadian-favs') || '[]'));
    const [codexes, media] = await Promise.all([
      fetch('data/codexes.json').then(r => r.json()),
      loadMedia(),
    ]);
    state.media = { ...state.media, ...media, baseUrl: CODEX_R2_BASE };
    const sel = $('#codexSelect');
    sel.innerHTML = codexes.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('');
    sel.onchange = () => loadCodex(sel.value);
    bindUI();
    if (codexes.length) await loadCodex(codexes[0].id);
    else setLoading('还没有可显示的法典数据');
  } catch (ex) {
    console.error(ex);
    setLoading('加载失败，请刷新页面重试');
  }
}

async function loadMedia() {
  try {
    const res = await fetch('data/media.json', { cache: 'no-store' });
    if (res.ok) return res.json();
  } catch {}
  return {};
}

async function loadCodex(id) {
  setLoading('正在加载词条数据…');
  clearMasonry();
  state.codex = await fetch(`data/${id}.json`).then(r => r.json());
  const c = state.codex;
  $('#codexTitle').textContent = c.title;
  $('#codexMeta').textContent = `${c.author ? c.author + ' · ' : ''}${c.version} · ${c.entryCount} 条`;
  state.activePath = [];
  state.query = '';
  $('#search').value = '';
  renderTree();
  applyFilter({ resetScroll: true });
  setLoading('');
}

function setLoading(text) {
  const el = $('#loading');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  $('#main')?.classList.toggle('is-loading', Boolean(text));
}

/* ---------------- 目录树 ---------------- */
function renderTree() {
  const nav = $('#tree');
  nav.innerHTML = '';
  const all = document.createElement('div');
  all.className = 'tree-row active';
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
    item.className = 'tree-item' + (depth >= 1 ? ' collapsed' : '');
    const row = document.createElement('div');
    row.className = 'tree-row';
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
  document.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
  rowEl.classList.add('active');
  if (window.innerWidth <= 600) $('#sidebar').classList.add('hidden');
  applyFilter({ resetScroll: true });
}

/* ---------------- 过滤 ---------------- */
function applyFilter(options = {}) {
  const q = state.query.trim().toLowerCase();
  let list = state.codex.entries;
  if (q) {
    list = list.filter(e => e.title.toLowerCase().includes(q) || e.tags.toLowerCase().includes(q));
  } else if (state.activePath.length) {
    const p = state.activePath;
    list = list.filter(e => p.every((seg, i) => e.path[i] === seg));
  }
  if (state.onlyImaged) list = list.filter(e => e.image);
  if (state.onlyFav) list = list.filter(e => state.favs.has(favKey(e)));
  state.list = list;
  updateResultBar();
  renderList(options);
}

function updateResultBar() {
  const n = state.list.length;
  let t;
  if (state.query.trim()) t = `搜索 “${esc(state.query.trim())}”：<b>${n}</b> 条结果`;
  else if (state.activePath.length) t = `${esc(state.activePath.join(' › '))}：<b>${n}</b> 条`;
  else if (state.onlyFav) t = `⭐ 我的收藏：<b>${n}</b> 条`;
  else t = `全部 <b>${n}</b> 条词条 · ${state.codex.imagedCount} 条已配图`;
  $('#resultInfo').innerHTML = t;
  $('#empty').hidden = n > 0;
}

/* ---------------- 虚拟瀑布流 ---------------- */
function colCount() {
  const w = $('#masonry').clientWidth || $('#main').clientWidth;
  return Math.max(1, Math.floor((w + GAP) / (CARD_MIN_WIDTH + GAP)));
}

function clearMasonry() {
  for (const node of state.nodes.values()) cleanupCard(node);
  state.nodes.clear();
  state.placements = [];
  state.rendered = 0;
  const m = $('#masonry');
  if (m) {
    m.innerHTML = '';
    m.style.height = '0px';
  }
}

function renderList({ resetScroll = false } = {}) {
  clearMasonry();
  if (resetScroll) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  computeLayout();
  updateVirtualCards(true);
}

function computeLayout() {
  const m = $('#masonry');
  const width = Math.max(1, m.clientWidth || $('#main').clientWidth || 1);
  const n = colCount();
  const itemWidth = Math.max(180, Math.floor((width - GAP * (n - 1)) / n));
  const colHeights = Array.from({ length: n }, () => 0);
  const placements = [];

  for (let i = 0; i < state.list.length; i++) {
    const entry = state.list[i];
    const col = shortestIndex(colHeights);
    const imageHeight = estimateImageHeight(entry, itemWidth);
    const body = estimateBodyMetrics(entry, itemWidth);
    const height = Math.ceil(imageHeight + body.height);
    const left = col * (itemWidth + GAP);
    const top = colHeights[col];

    placements.push(Object.freeze({
      index: i,
      entry,
      left,
      top,
      width: itemWidth,
      height,
      imageHeight,
      tagsHeight: body.tagsHeight,
    }));
    colHeights[col] += height + GAP;
  }

  state.placements = placements;
  state.colN = n;
  state.itemWidth = itemWidth;
  const totalHeight = placements.length ? Math.max(...colHeights) - GAP : 0;
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
  if (!e.image) return 0;
  const iw = Number(e.imageWidth || e.width || e.thumbWidth);
  const ih = Number(e.imageHeight || e.height || e.thumbHeight);
  const ratio = iw > 0 && ih > 0 ? ih / iw : DEFAULT_IMAGE_RATIO;
  return Math.round(width * clamp(ratio, 0.55, 1.9));
}

function estimateBodyMetrics(e, width) {
  const contentWidth = Math.max(120, width - 26);
  const titleLines = clamp(Math.ceil(textUnits(e.title) / Math.max(8, Math.floor(contentWidth / 14))), 1, 2);
  const tagLines = estimateTagLines(e.tags, contentWidth);
  const titleHeight = titleLines * 20;
  const tagsHeight = clamp(tagLines * 16 + 18, 42, 114);
  return {
    height: Math.ceil(12 + titleHeight + 8 + tagsHeight + 9 + 17 + 11),
    tagsHeight,
  };
}

function estimateTagLines(text, width) {
  const perLine = Math.max(18, Math.floor(width / 7));
  const lines = String(text || '').split(/\n+/).reduce((sum, line) => {
    return sum + Math.max(1, Math.ceil(textUnits(line) / perLine));
  }, 0);
  return clamp(lines, 2, MAX_TAG_LINES);
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
let lastRelayoutAt = 0;
function scheduleVirtualUpdate() {
  if (virtualRaf) return;
  virtualRaf = requestAnimationFrame(() => {
    virtualRaf = 0;
    updateVirtualCards();
  });
}

function updateVirtualCards(force = false) {
  const m = $('#masonry');
  if (!m || !state.placements.length) {
    state.rendered = 0;
    return;
  }

  const rect = m.getBoundingClientRect();
  const viewportTop = -rect.top;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
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
    } else if (force) {
      updateCardPosition(node, placement);
    }
  }

  for (const [index, node] of state.nodes) {
    if (next.has(index)) continue;
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
  node.querySelector('.card-tags').textContent = e.tags;
  node.querySelector('.card-path').textContent = e.path.join(' › ');
  if (e.isNew) node.querySelector('.badge-new').hidden = false;

  const fav = node.querySelector('.fav-btn');
  const faved = state.favs.has(favKey(e));
  fav.textContent = faved ? '★' : '☆';
  fav.classList.toggle('on', faved);
  fav.onclick = ev => { ev.stopPropagation(); toggleFav(e, fav); };

  if (e.image) {
    setupImage(node, placement);
  } else {
    node.classList.add('no-img');
  }

  node.onclick = () => copyEntry(e, node);
  return node;
}

function updateCardPosition(node, placement) {
  node.style.width = `${placement.width}px`;
  node.style.height = `${placement.height}px`;
  node.style.transform = `translate3d(${placement.left}px, ${placement.top}px, 0)`;
  const wrap = node.querySelector('.card-img-wrap');
  if (wrap && placement.imageHeight) wrap.style.height = `${placement.imageHeight}px`;
  const tags = node.querySelector('.card-tags');
  if (tags) tags.style.height = `${placement.tagsHeight}px`;
}

function setupImage(node, placement) {
  const e = placement.entry;
  const wrap = node.querySelector('.card-img-wrap');
  const img = node.querySelector('.card-img');
  const url = thumbUrl(e);
  const key = imageKey(e, url);

  wrap.hidden = false;
  wrap.style.height = `${placement.imageHeight}px`;
  wrap.classList.add('is-loading');
  img.alt = e.title;

  const markLoaded = () => {
    state.loadedImages.add(key);
    wrap.classList.remove('is-loading', 'is-error');
    img.classList.add('is-loaded');
  };
  const load = () => {
    node._imageTimer = 0;
    img.src = url;
  };

  img.onload = markLoaded;
  img.onerror = () => {
    const fallback = localAssetUrl('image', e);
    if (fallback && fallback !== img.src && img.dataset.fallbackTried !== '1') {
      img.dataset.fallbackTried = '1';
      img.src = fallback;
      return;
    }
    wrap.classList.remove('is-loading');
    wrap.classList.add('is-error');
  };

  if (state.loadedImages.has(key)) load();
  else node._imageTimer = window.setTimeout(load, IMAGE_LOAD_DELAY);

  wrap.querySelector('.zoom-btn').onclick = ev => {
    ev.stopPropagation();
    openLightbox(originalUrl(e) || img.src || url, img.src || url);
  };
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
  m.classList.add('is-relayouting');
  // Make sure the transition class is active before the new transforms land.
  void m.offsetWidth;
  clearTimeout(relayoutAnimTimer);
  relayoutAnimTimer = window.setTimeout(() => {
    m.classList.remove('is-relayouting');
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
  const text = e.tags;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  node.classList.add('copied');
  setTimeout(() => node.classList.remove('copied'), 600);
  toast(`已复制：${e.title}`);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = '✓ ' + msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------------- 收藏 ---------------- */
function favKey(e) { return state.codex.id + ':' + e.id; }
function toggleFav(e, btn) {
  const k = favKey(e);
  if (state.favs.has(k)) state.favs.delete(k); else state.favs.add(k);
  localStorage.setItem('fadian-favs', JSON.stringify([...state.favs]));
  const on = state.favs.has(k);
  if (btn) { btn.textContent = on ? '★' : '☆'; btn.classList.toggle('on', on); }
  if (state.onlyFav) applyFilter({ resetScroll: true });
}

/* ---------------- 灯箱 ---------------- */
function openLightbox(src, fallbackSrc = '') {
  const img = $('#lightboxImg');
  img.onerror = () => {
    if (fallbackSrc && img.dataset.fallbackTried !== '1') {
      img.dataset.fallbackTried = '1';
      img.src = fallbackSrc;
    }
  };
  img.dataset.fallbackTried = '';
  img.src = src;
  $('#lightbox').hidden = false;
}

function isLocalOrigin() {
  return ['localhost', '127.0.0.1', '::1'].includes(location.hostname) || location.protocol === 'file:';
}

function mediaPath(kind, e) {
  const file = kind === 'original' ? e.original : e.image;
  if (!file) return '';
  const prefix = kind === 'original' ? state.media.originalPrefix : state.media.imagePrefix;
  return [prefix || (kind === 'original' ? 'originals' : 'images'), state.codex.id, file]
    .map(part => encodeURIComponent(part).replace(/%2F/g, '/'))
    .join('/');
}

function withRev(url, e) {
  if (!url || !e.assetRev) return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(e.assetRev);
}

function localAssetUrl(kind, e) {
  return withRev(mediaPath(kind, e), e);
}

function assetUrl(kind, e) {
  const path = mediaPath(kind, e);
  if (!path) return '';
  if (isLocalOrigin() && state.media.localFallback !== false) return withRev(path, e);
  const base = String(state.media.baseUrl || '').replace(/\/+$/, '');
  return withRev(base ? `${base}/${path}` : path, e);
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
  $('#search').oninput = e => {
    clearTimeout(st);
    st = setTimeout(() => {
      state.query = e.target.value;
      if (state.query.trim()) {
        document.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
      }
      applyFilter({ resetScroll: true });
    }, 180);
  };

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

  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('hidden');
  $('#lightbox').onclick = () => { $('#lightbox').hidden = true; $('#lightboxImg').src = ''; };

  window.addEventListener('scroll', scheduleVirtualUpdate, { passive: true });

  window.addEventListener('resize', () => {
    scheduleRelayout(true);
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

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

init();
