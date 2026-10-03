import {
  BOARD_QUERY_CLIENT_DEPENDENCY,
  BOARD_SCOPE_DEPENDENCY,
  createBoardScope,
} from "@feeblo/public-feature-board/board-scope";
import { DbClient } from "@tanstack/react-db";
import type { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithDbClient } from "@tanstack/react-router-with-db";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { DashboardPendingShell } from "./dashboard/components/dashboard-pending-shell";
import { getContext } from "./dashboard/integrations/tanstack-query/root-provider";
import {
  createPublicBoardRewrite,
  type PublicBoardRewrite,
} from "./lib/public-board-rewrite";
// Import the generated route tree
import { routeTree } from "./routeTree.gen";

/**
 * The root domain, request-scoped on the server (Workers inject env per
 * request) and installed by the root env script before the client entry runs.
 */
const getRootDomain = createIsomorphicFn()
  .client(() => {
    // SAFETY: The root env script always writes this before hydration.
    const runtimeWindow = window as Window & {
      global?: { __ENV?: { APP_ROOT_DOMAIN?: string } };
    };
    return runtimeWindow.global?.__ENV?.APP_ROOT_DOMAIN ?? "";
  })
  .server(() => process.env.APP_ROOT_DOMAIN ?? "");

/**
 * The current-pathname accessor for the public board's slug scope.
 *
 * The board's collections resolve "which post/changelog entry am I on" from the
 * URL, because their query keys are built lazily (from a subset request, not
 * from a route). The browser reads the live location, since one client spans
 * navigations; the server *captures* the request's pathname while the router is
 * being built, because scope lookups also run after the render (subset
 * unloading, collection cleanup) where no request context exists — and it is
 * the visitor's public spelling, which is what `postSlugFromPath` expects.
 */
const getBoardPathname = createIsomorphicFn()
  .client(() => () => window.location.pathname)
  .server(() => {
    const { pathname } = new URL(getRequest().url);
    return () => pathname;
  });

export interface RouterContext {
  readonly queryClient: QueryClient;
  readonly dbClient: DbClient;
}

export function getRouter() {
  const { queryClient } = getContext();

  // One DB client per request (server) or per document (browser). Collection
  // descriptors are module-level, but every collection they materialize is
  // owned by this client, which is what keeps a Worker isolate from leaking
  // one board's rows into another's render.
  const boardScope = createBoardScope({ pathname: getBoardPathname() });
  const dbClient = new DbClient({
    [BOARD_QUERY_CLIENT_DEPENDENCY]: queryClient,
    [BOARD_SCOPE_DEPENDENCY]: boardScope,
  });

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    context: {
      queryClient,
      dbClient,
    },
    // Board hosts rewrite their public paths onto the internal `/s/...`
    // routes (and back) so the visitor's URL, the router's routes, and the
    // board's own client router all agree. See `lib/public-board-rewrite`.
    rewrite: createPublicBoardRewrite(
      getRootDomain
    ) satisfies PublicBoardRewrite,
    defaultPendingComponent: DashboardPendingShell,
    // The dashboard inherits the router's `pendingMinMs: 500` default, which
    // holds the route commit for 500ms after the data is already ready. That
    // hold is pure wait here, because the flash it guards against cannot
    // happen on either load path:
    //
    //   - Cold loads render the skeleton server-side, so it is on screen from
    //     first paint for the whole load — it can never flash late.
    //   - Client-side navigations measured 24-66ms (median 39ms) across the
    //     dashboard, 15-40x below the 1s `defaultPendingMs` gate, so the
    //     skeleton never appears at all.
    //
    // The paid cost is `max(0, pendingMinMs - elapsed)` on every load: measured
    // ~380ms at the 500ms default, and 0 here. Median time-to-content over 5
    // cold loads went 745ms -> 193ms when this was dropped. The public board
    // makes the same call for the same architecture; see
    // apps/public-feature-board/src/app/public-board-router.tsx.
    defaultPendingMinMs: 0,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: () => (
      <div className="flex h-full min-h-screen w-full items-center justify-center">
        <div>Error</div>
      </div>
    ),
  });

  // Hydrates the client from the server render's dehydrated DB state and, on
  // the server, dehydrates the queries the render preloaded.
  return routerWithDbClient(router, dbClient);
}

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
