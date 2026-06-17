# app.js split module map

This file records the first split of `site/assets/app.js`. It is meant to keep later refactors honest: module state moves with its functions, high-level callbacks use action injection, and the entry module wires everything before calling `init()`.

| Module | Main exports | Module state / closure state | Direct imports | Action injection |
| --- | --- | --- | --- | --- |
| `../app.js` | `init`, `loadCodex`, `applyFilter` | `codexLoadSeq` | all feature modules | injects router, codex UI, masonry, history, favorites, UI actions before `init()` |
| `state.js` | constants, `state`, `normalizeDensity`, `densityConfig` | shared `state` object | none | none |
| `utils.js` | `$`, `safeJsonParse`, path helpers, `prefersReducedMotion`, `updateSearchClear`, `updateScrollProgress`, `clamp`, `esc` | none | none | none |
| `feedback.js` | `setLoading`, `toast` | `toastTimer` | `utils.js` | none |
| `access.js` | `isNsfwCodex`, `isCodexLocked`, `firstUnlockedCodex`, `showNsfwLockedHint` | none | `state.js`, `feedback.js` | none |
| `data.js` | media/about/codex loading, normalization, tree build, status helpers | none | `state.js`, `utils.js`, `media.js`, `feedback.js` | none |
| `search.js` | query parse, matching, highlighting | none | `state.js`, `utils.js`, `media.js`, `favorites.js` | none |
| `router.js` | `setRouterActions`, `readUrlState`, `syncUrlState`, `openEntryDeepLink` | `routerActions` | `state.js`, `utils.js`, `media.js`, `feedback.js` | `onUrlSync`, `renderTree`, `applyFilter`, `openLightbox`, `updateVirtualCards` |
| `media.js` | image availability, asset paths, rev/cache bust URLs | none | `state.js`, `utils.js` | none |
| `copy.js` | `copyEntry`, `copyText`, prompt conversion/building | `NAI_WEIGHT_BASE` | `state.js`, `feedback.js`, `history.js` | none |
| `favorites.js` | `setFavoritesActions`, `favKey`, `toggleFav` | `favoriteActions` | `state.js`, `feedback.js` | `applyFilter` |
| `codex-ui.js` | codex picker/tree/banner/archive/result/empty/random UI | `codexUiActions`, `tipTimer`, `tipIndex`, `EXT_ICON` | `state.js`, `utils.js`, `access.js`, `data.js`, `media.js`, `feedback.js` | `loadCodex`, `applyFilter`, `openLightbox`, `syncUrlState`, `updateVirtualCards` |
| `masonry.js` | virtual masonry render, card creation, image setup, relayout/density anchors | `masonryActions`, `virtualRaf`, `relayoutTimer`, `relayoutAnimTimer`, `relayoutQueuedAnimate`, `relayoutAnimating`, `lastRelayoutAt` | `state.js`, `utils.js`, `feedback.js`, `search.js`, `media.js`, `copy.js`, `favorites.js`, `codex-ui.js` | `openLightbox`, `copyEntry`, `toggleFav` |
| `lightbox.js` | FLIP helpers, `openLightbox`, `closeLightbox`, `stepLightbox`, `renderLightbox`, `bindLightboxControls` | `lbSeq`, `lbCloseTimer`, `lbSourceImg`, `lbFocusReturn`, `lbPreloadCache` | `state.js`, `utils.js`, `masonry.js`, `search.js`, `copy.js`, `history.js`, `router.js`, `media.js` | none |
| `history.js` | `setHistoryActions`, recent entries, browse state save/resume/open | `historyActions`, `browseSaveTimer` | `state.js`, `utils.js`, `media.js`, `router.js`, `access.js`, `feedback.js` | `loadCodex`, `openEntryDeepLink`, `renderTree`, `applyFilter`, `updateVirtualCards` |
| `ui.js` | `setUiActions`, density orchestration, global UI binding | `uiActions`, `THEME_ICONS` | `state.js`, `utils.js`, `feedback.js`, `access.js`, `codex-ui.js`, `masonry.js`, `router.js`, `history.js`, `lightbox.js` | `loadCodex`, `applyFilter` |

## Wiring notes

- `app.js` imports modules statically, calls all `set*Actions(...)`, then calls `init()`.
- `router.js` does not import `history.js`; `syncUrlState()` calls injected `onUrlSync`.
- `router.js`, `history.js`, and `codex-ui.js` call masonry relayout through injected `updateVirtualCards`; they must not statically import `masonry.js` for that edge.
- `masonry.js` does not import lightbox or UI orchestration; card behavior is injected with `setMasonryActions(...)`.
- `favorites.js` owns favorite keys and persistence; it only asks the UI layer to re-filter via injected `applyFilter`.
- `copy.js` currently records copy side effects through `history.js`; `history.js` must not import `copy.js` unless that side effect is first moved to the orchestration layer.
- `ui.js` keeps `applyDensity()` as orchestration: state/localStorage/body class, control state, masonry anchor and relayout, and toast.
