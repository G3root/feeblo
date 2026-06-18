import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { boardRoute } from "./routes/board";
import { indexRoute } from "./routes/index";

const routeTree = rootRoute.addChildren([indexRoute, boardRoute]);

export function createWidgetRouter(initialRoute = "/") {
  const memoryHistory = createMemoryHistory({
    initialEntries: [initialRoute],
  });

  return createRouter({
    routeTree,
    history: memoryHistory,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createWidgetRouter>;
  }
}
