import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { feedbackRoute } from "./routes/feedback";
import { roadmapRoute } from "./routes/roadmap";
import { updatesRoute } from "./routes/updates";

const routeTree = rootRoute.addChildren([
  feedbackRoute,
  roadmapRoute,
  updatesRoute,
]);

export function createWidgetRouter(initialRoute = "/updates") {
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
