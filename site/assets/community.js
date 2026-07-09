import { COMMUNITY_CATEGORIES, DEFAULT_COMMUNITY_CATEGORY } from './community/constants.js';
import { loadCommunityData } from './community/api.js';
import { openCommunityDetail, initDetailDialog } from './community/detail.js';
import { initSubmitDialog, openSubmitDialog } from './community/submit.js';
import { state } from './community/state.js';
import { applyCommunityFilters, initCommunityUI, syncAfterLoad } from './community/ui.js';
import { $ } from './community/utils.js';

window.COMMUNITY_CATEGORIES = COMMUNITY_CATEGORIES;
window.DEFAULT_COMMUNITY_CATEGORY = DEFAULT_COMMUNITY_CATEGORY;
window.openSubmitDialog = openSubmitDialog;
window.openCommunityDetail = openCommunityDetail;
window.applyCommunityFilters = applyCommunityFilters;

async function loadAndRender() {
  state.loading = true;
  applyCommunityFilters();

  try {
    const { collection, data, entries } = await loadCommunityData();
    state.collection = collection;
    state.entries = entries;
    $('#communityTitle').textContent = data.title || '共创广场';
    $('#communityCount').textContent = `${entries.length} 条投稿`;
  } catch (error) {
    console.error('共创广场加载失败', error);
    state.entries = [];
    $('#communityCount').textContent = '0 条投稿';
  } finally {
    state.loading = false;
    syncAfterLoad();
  }
}

function init() {
  initDetailDialog();
  initSubmitDialog({ onSubmitted: () => {} });
  initCommunityUI({
    openDetail: openCommunityDetail,
    openSubmit: openSubmitDialog,
  });
  loadAndRender();
}

init();
