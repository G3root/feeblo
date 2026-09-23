import { createFileRoute } from "@tanstack/react-router";

import { handleBoardRobots } from "@/lib/public-board-endpoints";

/**
 * robots.txt for public board hosts. Reached as `/robots.txt` through the
 * board rewrite; the dashboard host's version is `routes/robots[.]txt.ts`.
 */
export const Route = createFileRoute("/s/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => handleBoardRobots(request),
    },
  },
});
