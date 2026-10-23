import { createFileRoute } from "@tanstack/react-router";

import { handleBoardLlmsTxt } from "@/lib/public-board-endpoints";

/**
 * llms.txt for public board hosts, served at
 * `https://<subdomain>.<root-domain>/llms.txt`.
 */
export const Route = createFileRoute("/s/llms.txt")({
  server: {
    handlers: {
      GET: ({ request }) => handleBoardLlmsTxt(request),
    },
  },
});
