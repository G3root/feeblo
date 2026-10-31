import { createFileRoute } from "@tanstack/react-router";

import {
  DASHBOARD_AGENT_CATALOG_PATH,
  DASHBOARD_API_CATALOG_PATH,
  DASHBOARD_MCP_SERVER_CARD_PATH,
  dashboardAgentCatalog,
  dashboardApiCatalog,
  dashboardMcpServerCard,
  isDashboardRequest,
  type DashboardDiscoveryDocument,
  wellKnownPath,
} from "@/lib/agent-discovery";

/**
 * The well-known discovery documents for the dashboard host.
 *
 * One splat route rather than a tree of nested files: every document is a
 * static JSON body, and a directory named `.well-known` is awkward to express
 * in the file-based router. Unknown paths 404 rather than falling through to
 * the app shell, so an agent gets a status it can interpret.
 */
const jsonResponse = (
  body: DashboardDiscoveryDocument,
  headers: Readonly<Record<string, string>> = {}
) =>
  new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...headers,
    },
  });

export const Route = createFileRoute("/.well-known/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        if (!isDashboardRequest(request)) {
          return new Response("Not found", { status: 404 });
        }

        const path = wellKnownPath(params._splat);

        switch (path) {
          case DASHBOARD_MCP_SERVER_CARD_PATH:
            return jsonResponse(dashboardMcpServerCard(), {
              // A hosted card MUST be readable by a browser-based client.
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET",
              "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
              "Access-Control-Expose-Headers": "ETag",
            });
          case DASHBOARD_API_CATALOG_PATH:
            return jsonResponse(dashboardApiCatalog(), {
              "Content-Type":
                'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
            });
          case DASHBOARD_AGENT_CATALOG_PATH:
            return jsonResponse(dashboardAgentCatalog(), {
              // The media type the discovery link advertises for the manifest.
              "Content-Type": "application/ai-catalog+json",
              // A registry reads this manifest from another origin.
              "Access-Control-Allow-Origin": "*",
            });
          default:
            return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
