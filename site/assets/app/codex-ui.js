import { state, RANDOM_RECENT_LIMIT, NSFW_LOCKED_MESSAGE } from './state.js';
import { $, esc, samePath, pathStartsWith, updateSearchClear } from './utils.js';
import { isCodexLocked, showNsfwLockedHint } from './access.js';
import { codexStatusLabel, codexStatusClass, codexStatusTitle } from './data.js';
import { hasEntryImage, thumbUrl } from './media.js';
import { toast } from './feedback.js';

const codexUiActions = {
  loadCodex: async () => {},
  applyFilter: () => {},
  syncUrlState: () => {},
  openLightbox: () => {},
  updateVirtualCards: () => {},
};

export function setCodexUiActions(actions = {}) {
  Object.assign(codexUiActions, actions);
}

/* ??????????? select ????????? */
export function setupCodexPicker() {
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
      codexUiActions.loadCodex(item.dataset.id);
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

export function updateCodexPickerState() {
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

/* ---------------- ??? ---------------- */
export function renderTree() {
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

export function buildNodes(nodes, parent, prefix, depth) {
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

export function selectPath(path, rowEl) {
  state.activePath = path;
  state.query = '';
  $('#search').value = '';
  updateSearchClear();
  document.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
  rowEl.classList.add('active');
  if (window.innerWidth <= 600) $('#sidebar').classList.add('closed');
  codexUiActions.applyFilter({ resetScroll: true });
  codexUiActions.syncUrlState();
}

/* 面包屑点击：按路径找到目录行，展开祖先并选中 */
export function selectPathByPath(path) {
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


export function updateResultBar() {
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

export function updateEmptyState(n) {
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

export function handleEmptyAction(action) {
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
  codexUiActions.applyFilter({ resetScroll: true });
  codexUiActions.syncUrlState();
}

export function randomExplore() {
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

export function randomKey(entry) {
  return `${state.codex?.id || ''}:${entry.id}`;
}

export function rememberRandomEntry(entry) {
  const key = randomKey(entry);
  state.recentRandomIds = [key, ...state.recentRandomIds.filter(id => id !== key)].slice(0, RANDOM_RECENT_LIMIT);
}

export function openRandomEntry(entry) {
  const index = state.list.findIndex(e => e.id === entry.id);
  const placement = index >= 0 ? state.placements[index] : null;
  if (placement) {
    const top = Math.max(0, placement.top + $('#masonry').getBoundingClientRect().top + window.scrollY - 120);
    window.scrollTo({ top, left: 0, behavior: 'auto' });
    codexUiActions.updateVirtualCards(true);
  }
  requestAnimationFrame(() => {
    const node = index >= 0 ? state.nodes.get(index) : null;
    const img = node?.querySelector('.card-img');
    codexUiActions.openLightbox(entry, 0, img || null);
    toast(`随机到了：${entry.title}`, '');
  });
}

/* ---------------- 法典横幅 / 分类轨道 ---------------- */
export function renderCodexHeader() {
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

export function updateRailActive() {
  const rail = $('#chipRail');
  if (!rail) return;
  const head = state.query.trim() ? null : (state.activePath[0] || '');
  rail.querySelectorAll('.rail-chip').forEach(ch => {
    ch.classList.toggle('active', head !== null && (ch.dataset.path || '') === head);
  });
}

/* 法典「关于」气泡：来源 / 贡献者 / 相关链接 */
const EXT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

export function closeBannerAbout() {
  const openBtn = document.querySelector('.banner-about-btn.open');
  const openPop = document.querySelector('.banner-pop:not([hidden])');
  if (!openBtn || !openPop) return;
  openPop.hidden = true;
  openBtn.classList.remove('open');
}

export function renderBannerAbout(c, banner) {
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

export function renderCodexArchive() {
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
export function setupAbout() {
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
