import { createFileRoute } from "@tanstack/react-router";

import { handleDashboardRobots } from "@/lib/public-board-endpoints";

/**
 * robots.txt for the dashboard host. Public board hosts serve their own from
 * `s/robots[.]txt.ts` (the board rewrite maps `/robots.txt` onto it).
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => handleDashboardRobots(),
    },
  },
});
