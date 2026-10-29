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

        const path = `/${(params._splat ?? "").replace(/^\/+/u, "")}`;

        switch (path) {
          case DASHBOARD_MCP_SERVER_CARD_PATH:
            return jsonResponse(dashboardMcpServerCard());
          case DASHBOARD_API_CATALOG_PATH:
            return jsonResponse(dashboardApiCatalog(), {
              "Content-Type":
                'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
            });
          case DASHBOARD_AGENT_CATALOG_PATH:
            return jsonResponse(dashboardAgentCatalog(), {
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
