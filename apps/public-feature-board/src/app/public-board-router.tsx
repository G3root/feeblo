import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./public-board-routes";

export function createRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingComponent: () => null,
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
