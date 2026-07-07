# app.js split module map

This file records the first split of `site/assets/app.js`. It is meant to keep later refactors honest: module state moves with its functions, high-level callbacks use action injection, and the entry module wires everything before calling `init()`.

| Module | Main exports | Module state / closure state | Direct imports | Action injection |
| --- | --- | --- | --- | --- |
| `../app.js` | `init`, `loadCodex`, `openFavoritesView`, `applyFilter` | `codexLoadSeq` | all feature modules | injects router, codex UI, masonry, history, favorites, UI actions before `init()` |
| `state.js` | constants, `state`, `normalizeDensity`, `densityConfig` | shared `state` object | none | none |
| `utils.js` | `$`, `safeJsonParse`, path helpers, `prefersReducedMotion`, `updateSearchClear`, `updateScrollProgress`, `clamp`, `esc` | none | none | none |
| `modal.js` | `openMask`, `closeMask`, `trapFocus`, focus helpers | `maskTimers`, `maskOpeners` | `utils.js` | none |
| `feedback.js` | `setLoading`, `showSkeleton`, `hideSkeleton`, `toast` | `toastTimer`, skeleton timing state | `utils.js` | none |
| `access.js` | `isNsfwCodex`, `isCodexLocked`, `firstUnlockedCodex`, `showNsfwLockedHint` | none | `state.js`, `feedback.js` | none |
| `data.js` | media/about/codex loading, normalization, tree build, status helpers | none | `state.js`, `utils.js`, `media.js`, `feedback.js` | none |
| `search.js` | query parse, matching, highlighting | none | `state.js`, `utils.js`, `media.js`, `favorites.js` | none |
| `router.js` | `setRouterActions`, `readUrlState`, `syncUrlState`, `openEntryDeepLink` | `routerActions` | `state.js`, `utils.js`, `media.js`, `feedback.js` | `onUrlSync`, `renderTree`, `applyFilter`, `openLightbox`, `updateVirtualCards` |
| `media.js` | image availability, asset paths, rev/cache bust URLs | none | `state.js`, `utils.js` | none |
| `copy.js` | `copyEntry`, `copyText`, prompt conversion/building | `NAI_WEIGHT_BASE` | `state.js`, `feedback.js`, `history.js` | none |
| `favorites.js` | `setFavoritesActions`, `favKey`, `favKeys`, `isFav`, `toggleFav`, `saveFavs` | `favoriteActions` | `state.js`, `feedback.js`, `data.js` | `applyFilter` |
| `fav-codex.js` | `FAVORITES_CODEX_ID`, `buildFavoritesCodex` | none | `state.js`, `data.js`, `access.js`, `media.js` | none |
| `report.js` | `setupReport`, `openReportDialog`, feedback context packing | `currentPayload`, `currentTrigger` | `state.js`, `utils.js`, `feedback.js`, `modal.js`, `media.js` | none |
| `announcements.js` | `setupAnnouncements`, `loadAnnouncements`, `openAnnouncementsPanel`, badge update | `announcements`, loading flags | `utils.js`, `modal.js`, `history.js` | none |
| `onboarding.js` | `setupOnboarding`, `maybeShowOnboarding` | `initialRouteUrl`, `step`, `prompted` | `utils.js`, `modal.js` | none |
| `codex-ui.js` | codex picker/tree/banner/archive/result/empty/random UI | `codexUiActions`, `tipTimer`, `tipIndex`, `EXT_ICON` | `state.js`, `utils.js`, `access.js`, `data.js`, `media.js`, `feedback.js` | `loadCodex`, `applyFilter`, `openLightbox`, `syncUrlState`, `updateVirtualCards` |
| `masonry.js` | virtual masonry render, card creation, image setup, relayout/density anchors | `masonryActions`, `virtualRaf`, `relayoutTimer`, `relayoutAnimTimer`, `relayoutQueuedAnimate`, `relayoutAnimating`, `lastRelayoutAt` | `state.js`, `utils.js`, `feedback.js`, `search.js`, `media.js`, `copy.js`, `favorites.js`, `codex-ui.js` | `openLightbox`, `copyEntry`, `toggleFav`, `reportEntry` |
| `lightbox.js` | FLIP helpers, `openLightbox`, `closeLightbox`, `stepLightbox`, `renderLightbox`, `bindLightboxControls` | `lbSeq`, `lbCloseTimer`, `lbSourceImg`, `lbFocusReturn`, `lbPreloadCache` | `state.js`, `utils.js`, `masonry.js`, `search.js`, `copy.js`, `history.js`, `router.js`, `media.js`, `access.js`, `report.js` | none |
| `history.js` | `setHistoryActions`, recent entries, browse state save/resume/open | `historyActions`, `browseSaveTimer` | `state.js`, `utils.js`, `media.js`, `router.js`, `access.js`, `feedback.js`, `data.js`, `fav-codex.js` | `loadCodex`, `openFavoritesView`, `openEntryDeepLink`, `renderTree`, `applyFilter`, `updateVirtualCards` |
| `ui.js` | `setUiActions`, density orchestration, global UI binding | `uiActions`, `THEME_ICONS` | `state.js`, `utils.js`, `feedback.js`, `access.js`, `codex-ui.js`, `masonry.js`, `router.js`, `history.js`, `lightbox.js`, `modal.js`, `announcements.js`, `report.js`, `onboarding.js` | `loadCodex`, `openFavoritesView`, `applyFilter` |

## Wiring notes

- `app.js` imports modules statically, calls all `set*Actions(...)`, then calls `init()`.
- `router.js` does not import `history.js`; `syncUrlState()` calls injected `onUrlSync`.
- `router.js`, `history.js`, and `codex-ui.js` call masonry relayout through injected `updateVirtualCards`; they must not statically import `masonry.js` for that edge.
- `masonry.js` does not import lightbox or UI orchestration; card behavior is injected with `setMasonryActions(...)`.
- `masonry.js` calls feedback through injected `reportEntry`; `report.js` owns submission, context packing, fallback copy, and must not import masonry.
- `modal.js` owns shared mask/focus behavior; UI modules may import it directly instead of creating per-dialog focus traps.
- `favorites.js` owns favorite keys and persistence; it only asks the UI layer to re-filter via injected `applyFilter`. Keys always belong to an entry's REAL codex: entries from the favorites view carry `_srcCodexId` and are resolved through `findCodexMeta`.
- `fav-codex.js` builds the temporary "全部收藏" view data (id `favorites`, not registered in `state.codexes`): it merges favorited entries from all codices via `fetchCodex` (cached), resolves cross-codex image paths (codex-mode sources get `assetCodexId`, relative-mode sources get pre-resolved absolute URLs), prefixes `path` with the source codex name (tree groups by source), and tags entries with `_srcCodexId`/`_srcCodexTitle`/`_srcType`/`_srcPath`. `app.js` enters this view through `openFavoritesView()` while keeping `state.browseCodex` as the real selected codex; URL sync writes the real `codex` plus `fav=1`, and the topbar favorite toggle is the user-facing entry/exit. Consumers of `_src*`: `favorites.js` (keys), `history.js` (recent entries), `report.js` (feedback context), `masonry.js` (pack behavior).
- `copy.js` currently records copy side effects through `history.js`; `history.js` must not import `copy.js` unless that side effect is first moved to the orchestration layer.
- `ui.js` keeps `applyDensity()` as orchestration: state/localStorage/body class, control state, masonry anchor and relayout, and toast.
