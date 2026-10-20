import { getCachedAuthSession } from "@feeblo/web-shared/auth-session";
import {
  COLLECTION_CONTEXT_DEPENDENCY,
  COLLECTION_QUERY_CLIENT_DEPENDENCY,
  createCollectionContext,
  type CollectionContext,
} from "@feeblo/web-shared/collection-context";
import { postSlugFromPath } from "@feeblo/web-shared/collections";
import type { DbClient } from "@tanstack/react-db";

/**
 * The board's collection context.
 *
 * It is the shared {@link CollectionContext} implemented over the board's URL
 * shape: the organization the host resolved, and the post or changelog slug in
 * the URL. Collections read both through this object instead of `window`,
 * which is what lets the same descriptors materialize on the server, where
 * there is no `window` and no client-side navigation.
 *
 * The dashboard implements the same interface over its route, so one
 * `DbClient` carries whichever surface's context the document renders.
 *
 * The object is created once per `DbClient` — per request on the server, per
 * document in the browser — so the mutable organization id it carries cannot
 * leak across requests even though the collections that read it are
 * module-level descriptors. The pathname stays a *function* because the
 * browser client outlives any single route: slugs are resolved from the
 * current location at query time, exactly as they were before, and the server
 * resolves them from the request URL.
 */
export type BoardScope = CollectionContext;

/**
 * The names the board's collections and tests already use for the shared keys.
 *
 * Aliases rather than separate keys: a document renders either the dashboard
 * or a public board, and both clients publish the context under the same key.
 */
export const BOARD_SCOPE_DEPENDENCY = COLLECTION_CONTEXT_DEPENDENCY;
export const BOARD_QUERY_CLIENT_DEPENDENCY = COLLECTION_QUERY_CLIENT_DEPENDENCY;

/**
 * Creates the board's context for one `DbClient`.
 *
 * `pathname` is called per lookup rather than captured so a browser client
 * (which spans navigations) always resolves the slug of the page it is on. The
 * host supplies it — `createIsomorphicFn` in `apps/web/src/router.tsx` reads
 * `window.location.pathname` in the browser and the request URL on the server,
 * so this module never has to ask which environment it is in.
 */
export function createBoardScope(options: {
  organizationId?: string;
  pathname: () => string | undefined;
}): BoardScope {
  const { pathname } = options;

  return createCollectionContext({
    organizationId: options.organizationId,
    getChangelogSlug: () => {
      const currentPathname = pathname();
      return currentPathname === undefined
        ? undefined
        : postSlugFromPath(currentPathname, "changelog", 1);
    },
    getPostSlug: () => {
      const currentPathname = pathname();
      return currentPathname === undefined
        ? undefined
        : postSlugFromPath(currentPathname, "p", 1);
    },
  });
}

/**
 * Publishes the resolved site's organization id onto the client's context.
 *
 * Called before any collection materializes, because the organization id is
 * part of every collection's query key. The layout publishes it on the server
 * from the route's `beforeLoad`, and in the browser from its render — but a
 * child route's `beforeLoad` runs *before* that render on a fresh document
 * (hydration does not re-run the parent's `beforeLoad`), so the board's
 * preload helpers publish it themselves before materializing a collection.
 * A collection that materializes first would key its on-demand subsets
 * without the organization, and the later unload of that preload would
 * decrement the component's key instead — deleting rows the page renders.
 */
export function setBoardOrganizationId(
  client: DbClient,
  organizationId: string | undefined
): void {
  client
    .requireDependency<BoardScope>(BOARD_SCOPE_DEPENDENCY)
    .setOrganizationId(organizationId);
}

/**
 * Records that a server preload for this request degraded.
 *
 * Called by the board's preload helpers when `settlePreloads` reports a
 * timeout or failure, so the layout can refuse to cache or index a page that
 * rendered without the data it asked for.
 */
export function markBoardPreloadDegraded(client: DbClient): void {
  client
    .requireDependency<BoardScope>(BOARD_SCOPE_DEPENDENCY)
    .markPreloadDegraded();
}

/**
 * Whether this request's render lost content to a slow or failing preload.
 *
 * Read by the board layout when it decides the document's cache and index
 * policy: a page whose own preload degraded must not be cached or indexed,
 * even when the shell's preload succeeded.
 */
export function isBoardPreloadDegraded(client: DbClient): boolean {
  return client
    .requireDependency<BoardScope>(BOARD_SCOPE_DEPENDENCY)
    .isPreloadDegraded();
}

/**
 * Organization id for a board mutation.
 *
 * Mutations are always scoped to the organization hosting this public board.
 * A restricted SSO session must never use a client-supplied entity
 * organization id to act on a different board.
 */
export function requireMutationOrganizationId(scope: BoardScope): string {
  const organizationId = scope.getOrganizationId();

  if (!organizationId) {
    throw new Error("Missing public board organization id");
  }

  const restrictedToOrganizationId =
    getCachedAuthSession()?.user.restrictedToOrganizationId;

  if (
    restrictedToOrganizationId &&
    restrictedToOrganizationId !== organizationId
  ) {
    throw new Error("Session is not authorized for this organization");
  }

  return organizationId;
}
