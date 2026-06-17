import { state, DENSITY_PRESETS, DENSITY_STORAGE_KEY, NSFW_STORAGE_KEY } from './state.js';
import { normalizeDensity, densityConfig } from './state.js';
import { $, updateSearchClear, updateScrollProgress, prefersReducedMotion } from './utils.js';
import { toast } from './feedback.js';
import { firstUnlockedCodex, isNsfwCodex } from './access.js';
import { closeBannerAbout, renderCodexArchive, renderTree, randomExplore, updateCodexPickerState } from './codex-ui.js';
import { syncUrlState } from './router.js';
import { renderHistoryPanel, resumeLastBrowse, openRecentEntry, saveRecentEntries, scheduleBrowseStateSave } from './history.js';
import { captureMasonryAnchor, restoreMasonryAnchor, relayoutVisible, updateVirtualCards, scheduleVirtualUpdate, scheduleRelayout } from './masonry.js';
import { bindLightboxControls } from './lightbox.js';

const THEME_ICONS = {
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
};

const uiActions = {
  loadCodex: async () => {},
  applyFilter: () => {},
};

export function setUiActions(actions = {}) {
  Object.assign(uiActions, actions);
}

export function updateDensityControls() {
  for (const btn of document.querySelectorAll('[data-density]')) {
    const active = btn.dataset.density === state.density;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

export function applyDensity(value, { render = true, announce = false } = {}) {
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

export function bindUI() {
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
      uiActions.applyFilter({ resetScroll: true });
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
      uiActions.applyFilter({ resetScroll: true });
      syncUrlState();
      searchInput.focus();
    };
  }

  $('#onlyImaged').onchange = e => { state.onlyImaged = e.target.checked; uiActions.applyFilter({ resetScroll: true }); };
  $('#onlyFav').onchange = e => { state.onlyFav = e.target.checked; uiActions.applyFilter({ resetScroll: true }); };

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
      if (fallback) uiActions.loadCodex(fallback.id, { replaceUrl: true });
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
  bindLightboxControls({ mobileQuery });

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
