import { getCachedAuthSession } from "@feeblo/web-shared/auth-session";
import { postSlugFromPath } from "@feeblo/web-shared/collections";
import type { DbClient } from "@tanstack/react-db";

/**
 * The board's request scope, as a `DbClient` dependency.
 *
 * A public board document is scoped to one organization (the host's
 * subdomain) and one viewed entity (the post or changelog slug in the URL).
 * Collections read both through this object instead of `window`, which is what
 * lets the same descriptors materialize on the server, where there is no
 * `window` and no client-side navigation.
 *
 * The object is created once per `DbClient` — per request on the server, per
 * document in the browser — so the mutable organization id it carries cannot
 * leak across requests even though the collections that read it are
 * module-level descriptors. The pathname stays a *function* because the
 * browser client outlives any single route: slugs are resolved from the
 * current location at query time, exactly as they were before, and the server
 * resolves them from the request URL.
 */
export interface BoardScope {
  getOrganizationId(): string | undefined;
  setOrganizationId(organizationId: string | undefined): void;
  getPostSlug(): string | undefined;
  getChangelogSlug(): string | undefined;
  /**
   * Records that a server preload for this request timed out or failed, so the
   * document it produces is incomplete and must not be cached or indexed.
   */
  markPreloadDegraded(): void;
  isPreloadDegraded(): boolean;
}

/** `DbClient` dependency key holding the board's {@link BoardScope}. */
export const BOARD_SCOPE_DEPENDENCY = "boardScope";

/** `DbClient` dependency key holding the request's TanStack Query client. */
export const BOARD_QUERY_CLIENT_DEPENDENCY = "queryClient";

/**
 * Creates the scope for one `DbClient`.
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
  let organizationId = options.organizationId;
  let preloadDegraded = false;
  const { pathname } = options;

  return {
    getChangelogSlug: () => {
      const currentPathname = pathname();
      return currentPathname === undefined
        ? undefined
        : postSlugFromPath(currentPathname, "changelog", 1);
    },
    getOrganizationId: () => organizationId,
    isPreloadDegraded: () => preloadDegraded,
    markPreloadDegraded: () => {
      preloadDegraded = true;
    },
    getPostSlug: () => {
      const currentPathname = pathname();
      return currentPathname === undefined
        ? undefined
        : postSlugFromPath(currentPathname, "p", 1);
    },
    setOrganizationId: (next) => {
      organizationId = next;
    },
  };
}

/**
 * Publishes the resolved site's organization id onto the client's scope.
 *
 * Called by the board layout before any collection materializes: on the
 * server from the route's `beforeLoad`, and in the browser from the layout's
 * render (hydration does not re-run `beforeLoad`, and a parent renders before
 * its children).
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
