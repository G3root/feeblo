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
