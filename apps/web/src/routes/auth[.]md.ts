import { createFileRoute } from "@tanstack/react-router";

import {
  dashboardAuthMarkdown,
  isDashboardRequest,
} from "@/lib/agent-discovery";

/**
 * The agent authentication guide for the dashboard host. A handler-only route,
 * so it is answered before the document renderer's HTML-only guard: a request
 * with `Accept: text/markdown` reaches this GET instead of being refused.
 */
export const Route = createFileRoute("/auth.md")({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isDashboardRequest(request)) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(
          dashboardAuthMarkdown(new URL(request.url).origin),
          {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            },
          }
        );
      },
    },
  },
});
