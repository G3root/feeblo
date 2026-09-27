/**
 * The public board's component surface.
 *
 * The board's *routes* belong to the host app (`apps/web/src/routes/s/...`),
 * so the host router can render them on the server like any other route. What
 * lives here is everything the routes render: pages, components, collection
 * descriptors, the request scope, and the preload helpers.
 */
export {
  BOARD_QUERY_CLIENT_DEPENDENCY,
  BOARD_SCOPE_DEPENDENCY,
  type BoardScope,
  createBoardScope,
  requireMutationOrganizationId,
  setBoardOrganizationId,
} from "./lib/board-scope";
export { boardPaths } from "./lib/board-links";
export {
  applyPublicCollectionIndexes,
  createPublicCollections,
  type PublicCollections,
} from "./lib/collections";
export type { PreloadOutcome } from "./lib/preloads";
export {
  preloadBoardChangelog,
  preloadBoardRoadmap,
  preloadBoardShell,
  preloadChangelogDetail,
  preloadPostDetail,
  preloadPostUserState,
  settlePreloads,
} from "./lib/preloads";
export {
  initPublicBoardI18n,
  isPublicBoardI18nInitialized,
  type PublicBoardI18nRuntime,
} from "./i18n";
