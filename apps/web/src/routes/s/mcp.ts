import { createFileRoute } from "@tanstack/react-router";

import { handleHelpCenterMcpEndpoint } from "@/lib/help-center-agent-endpoints";

/**
 * The keyless MCP server for a board's published help center, served at
 * `https://<subdomain>.<root-domain>/mcp`.
 *
 * Streamable HTTP is POST-only here: the server sends no unsolicited messages,
 * so there is no `GET` stream to open, and it keeps no session to delete.
 */
export const Route = createFileRoute("/s/mcp")({
  server: {
    handlers: {
      DELETE: () =>
        new Response(null, { status: 405, headers: { Allow: "POST" } }),
      GET: () =>
        new Response(null, { status: 405, headers: { Allow: "POST" } }),
      POST: ({ request }) => handleHelpCenterMcpEndpoint(request),
    },
  },
});
