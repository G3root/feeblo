import { createFileRoute } from "@tanstack/react-router";

import { handleBoardRss } from "@/lib/public-board-endpoints";

/**
 * RSS 2.0 feed for the public changelog, served at
 * `https://<subdomain>.<root-domain>/changelog/rss.xml`.
 *
 * The Astro version delegated the envelope to `@astrojs/rss`; the handler is
 * hand-written now (see `~/lib/public-board-endpoints`) so no Astro-only
 * package is required.
 */
export const Route = createFileRoute("/s/changelog/rss.xml")({
  server: {
    handlers: {
      GET: ({ request }) => handleBoardRss(request),
    },
  },
});
