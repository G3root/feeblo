import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";

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

export function getRouter() {
  const { queryClient } = getContext();
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    context: {
      queryClient,
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

  return router;
}

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
