import { createFileRoute } from "@tanstack/react-router";

import { handleBoardSitemap } from "@/lib/public-board-endpoints";

/**
 * sitemap.xml for public board hosts, served at
 * `https://<subdomain>.<root-domain>/sitemap.xml`.
 */
export const Route = createFileRoute("/s/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) => handleBoardSitemap(request),
    },
  },
});
