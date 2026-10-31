import { createFileRoute } from "@tanstack/react-router";

import { handleDashboardSitemap } from "@/lib/public-board-endpoints";

/**
 * sitemap.xml for the dashboard host. Public board hosts serve their own from
 * `s/sitemap[.]xml.ts` (the board rewrite maps `/sitemap.xml` onto it).
 */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) => handleDashboardSitemap(request),
    },
  },
});
