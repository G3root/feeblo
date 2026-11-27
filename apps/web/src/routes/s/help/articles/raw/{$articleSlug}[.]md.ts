import { createFileRoute } from "@tanstack/react-router";

import { handleHelpCenterArticleMarkdown } from "@/lib/help-center-agent-endpoints";

/**
 * The raw Markdown mirror of one help center article, served at
 * `https://<subdomain>.<root-domain>/help/articles/raw/<slug>.md`.
 *
 * The page's "Copy as Markdown" action copies the in-memory body; this route
 * exists for the readers that cannot: an assistant behind "Open in chat", a
 * script, or a person who follows the mirror URL.
 */
export const Route = createFileRoute("/s/help/articles/raw/{$articleSlug}.md")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        handleHelpCenterArticleMarkdown(request, params.articleSlug),
    },
  },
});
