import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { PublicBoardPending } from "../components/layout/public-board-pending";
import { routeTree } from "./public-board-routes";

export function createRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    // Public routes preload RPC-backed collections in `beforeLoad`, so the
    // pending skeleton is the visible state for every cold load. Show it
    // immediately (`pendingMs: 0`) and drop it the moment data is ready
    // (`pendingMinMs: 0`) — this also keeps the handoff from the
    // server-rendered fallback gap-free, since the island hydrates straight
    // into the pending state.
    defaultPendingComponent: PublicBoardPending,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });

  return router;
}

export const router = createRouter();

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
