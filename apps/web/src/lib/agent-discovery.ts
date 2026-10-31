import { isDashboardHost } from "@/lib/public-board-rewrite";

/**
 * The discovery documents the dashboard origin serves for agents.
 *
 * The dashboard is a browser surface, so its contribution to discovery is
 * telling an agent where the machine surface is. Every document points at the
 * API origin instead of inventing a second contract here, and it names the
 * paths `apps/server` serves so a client that starts at either origin lands on
 * the same set.
 *
 * These are intentionally not imported from `@feeblo/domain/public-api`: that
 * module carries the authentication middleware, the rate limiter and the MCP
 * toolkit, and none of it belongs in the dashboard worker's bundle.
 */

const PUBLIC_API_PATH = "/api/v1";
const OPENAPI_PATH = `${PUBLIC_API_PATH}/openapi.json`;
const REFERENCE_PATH = `${PUBLIC_API_PATH}/docs`;

/** Mirrors `PUBLIC_API_MCP_PATH` and `PUBLIC_API_KEY_HEADER` in `@feeblo/domain`. */
const PUBLIC_API_MCP_PATH = "/mcp";
const PUBLIC_API_KEY_HEADER = "x-api-key";

export const DASHBOARD_AUTH_PATH = "/auth.md";
export const DASHBOARD_API_CATALOG_PATH = "/.well-known/api-catalog";
export const DASHBOARD_MCP_SERVER_CARD_PATH =
  "/.well-known/mcp/server-card.json";
export const DASHBOARD_AGENT_CATALOG_PATH = "/.well-known/ai-catalog.json";

const API_ORIGIN_FALLBACK = "https://api.feeblo.com";

/**
 * The API origin the documents advertise.
 *
 * Read from configuration rather than derived from the request: the dashboard
 * and the API are separate deployments, and a preview dashboard must point at
 * the API it was configured with, not at the host the visitor typed.
 */
export const apiOrigin = () => {
  const configured = process.env.API_URL;

  if (configured === undefined || configured === "") {
    return API_ORIGIN_FALLBACK;
  }

  try {
    return new URL(configured).origin;
  } catch {
    return API_ORIGIN_FALLBACK;
  }
};

/**
 * Whether this request belongs to the dashboard host.
 *
 * Public board hosts and custom domains share the router but not the product:
 * serving them the platform's auth guide would tell a visitor's agent to
 * fetch a Feeblo key it has no use for.
 */
export const isDashboardRequest = (request: Request) =>
  isDashboardHost(
    new URL(request.url).hostname,
    process.env.APP_ROOT_DOMAIN ?? ""
  );

/**
 * `/auth.md` — where an agent gets the credential the API accepts.
 *
 * Deliberately a pointer rather than a second copy of the error table: the
 * canonical guide lives on the API origin, which is the origin that enforces
 * it, and two copies of a status table drift.
 */
export const dashboardAuthMarkdown = (origin: string) => {
  const api = apiOrigin();

  return `# Feeblo auth.md

The agent authentication guide for this origin. This host is the Feeblo
dashboard, which a person uses in a browser; an agent should not drive it.

Feeblo's machine surfaces accept exactly one credential: a workspace API key,
created by a person in this dashboard under **Settings → Developers**. The
plaintext key is shown once, starts with \`fbk_\`, and is sent in the
\`${PUBLIC_API_KEY_HEADER}\` header.

- API: ${api}${PUBLIC_API_PATH}
- OpenAPI document: ${api}${OPENAPI_PATH}
- Reference, readable without a key: ${api}${REFERENCE_PATH}
- MCP endpoint: ${api}${PUBLIC_API_MCP_PATH} (streamable HTTP)
- Full guide, including the error tags and the rate limit: ${api}/auth.md
- API catalog: ${api}/.well-known/api-catalog

A missing or invalid key answers \`401\`; a key without the scope an endpoint
needs answers \`403 FORBIDDEN_SCOPE\`. Switch on the error \`_tag\`, never on
\`message\`. Ask the person before any write: creating, updating, deleting, or
publishing changes a real workspace, and publishing a changelog entry emails
every subscriber.

Dashboard pages: ${origin}/
`;
};

/**
 * The SEP-1649 card for the MCP server this dashboard's workspace owns.
 *
 * The endpoint is cross-origin on purpose. The card is how a client that only
 * knows the dashboard hostname finds the transport, and the transport is
 * served by the API deployment; the card states the origin it points at rather
 * than implying a server runs here.
 */
export const dashboardMcpServerCard = () => {
  const api = apiOrigin();

  return {
    // The Server Card extension's required fields. `remotes` is where the
    // transport lives; `serverInfo`/`endpoint` below are the earlier draft's
    // fields, kept because the readiness scanner and older clients read them
    // and the extension leaves additional properties open.
    $schema:
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "com.feeblo/public-api",
    version: "1.0.0",
    description:
      "Read and manage one Feeblo workspace: posts, comments, votes, boards, and changelog.",
    remotes: [
      {
        type: "streamable-http",
        url: `${api}${PUBLIC_API_MCP_PATH}`,
        supportedProtocolVersions: [
          "2026-07-28",
          "2025-11-25",
          "2025-06-18",
          "2025-03-26",
          "2024-11-05",
        ],
        headers: [
          {
            name: PUBLIC_API_KEY_HEADER,
            isRequired: true,
            isSecret: true,
            description:
              "Workspace API key. The value is created in the dashboard and is never published in this card.",
          },
        ],
      },
    ],
    serverInfo: { name: "feeblo-public-api", version: "1.0.0" },
    endpoint: `${api}${PUBLIC_API_MCP_PATH}`,
    transport: { type: "streamable-http" },
    capabilities: { tools: {} },
    authentication: {
      required: true,
      scheme: PUBLIC_API_KEY_HEADER,
      documentation: `${api}/auth.md`,
    },
    documentation: "https://docs.feeblo.com/developers/mcp",
  };
};

/** RFC 9727 catalog for the HTTP API the dashboard's writes go through. */
export const dashboardApiCatalog = () => {
  const api = apiOrigin();

  return {
    linkset: [
      {
        anchor: `${api}${PUBLIC_API_PATH}`,
        "service-desc": [
          { href: `${api}${OPENAPI_PATH}`, type: "application/json" },
        ],
        "service-doc": [
          { href: `${api}${REFERENCE_PATH}`, type: "text/html" },
          { href: "https://docs.feeblo.com/developers/public-api" },
        ],
        "service-meta": [{ href: `${api}/auth.md`, type: "text/markdown" }],
      },
    ],
  };
};

/**
 * The ARD manifest for the same API.
 *
 * Identifiers name the API's host, not the dashboard's: a registry that keys
 * an entry by `app.feeblo.com` would resolve it back to the browser surface it
 * is trying to avoid.
 */
export const dashboardAgentCatalog = () => {
  const api = apiOrigin();
  const host = new URL(api).hostname;

  return {
    specVersion: "1.0",
    host: { displayName: "Feeblo", identifier: `urn:feeblo:${host}` },
    entries: [
      {
        identifier: `urn:air:${host}:mcp:public-api`,
        displayName: "Feeblo Public API MCP server",
        type: "application/mcp-server-card+json",
        url: `${api}/.well-known/mcp/server-card.json`,
        representativeQueries: [
          "list the boards in my workspace",
          "which posts are open and unassigned",
        ],
      },
      {
        identifier: `urn:air:${host}:openapi:public-api`,
        displayName: "Feeblo Public API",
        type: "application/vnd.oai.openapi+json",
        url: `${api}${OPENAPI_PATH}`,
        representativeQueries: [
          "add a comment to a post",
          "read the changelog entries for this workspace",
        ],
      },
    ],
  };
};

/**
 * The Markdown representation of the dashboard root.
 *
 * An agent that asks for `text/markdown` is not going to drive a React app; it
 * needs to know what this host is and where the machine surface is. The
 * dashboard's own HTML is unchanged for a browser.
 */
export const dashboardMarkdown = (origin: string) => {
  const api = apiOrigin();

  return `# Feeblo

> The dashboard for one Feeblo workspace: posts, comments, votes, boards,
> changelog entries, and settings. It is a browser surface for a person.

An agent should use the Public API or the MCP transport instead, with a
workspace API key created by a person in this dashboard.

- API: ${api}${PUBLIC_API_PATH}
- Reference: ${api}${REFERENCE_PATH}
- Authentication: ${api}/auth.md
- MCP endpoint: ${api}${PUBLIC_API_MCP_PATH}
- MCP server card: ${api}/.well-known/mcp/server-card.json
- Documentation: https://docs.feeblo.com/llms.txt

This origin publishes the same discovery set under its own well-known paths,
so a client that starts here does not have to guess the API hostname.

- Authentication guide: ${origin}/auth.md
- API catalog: ${origin}/.well-known/api-catalog
- Capability manifest: ${origin}/.well-known/ai-catalog.json
`;
};

/**
 * Every JSON body the well-known splat route can answer with.
 *
 * Naming the union keeps the response helper from taking `unknown`: a document
 * that is not one of these three is a compile error rather than a serialized
 * surprise.
 */
export type DashboardDiscoveryDocument =
  | ReturnType<typeof dashboardMcpServerCard>
  | ReturnType<typeof dashboardApiCatalog>
  | ReturnType<typeof dashboardAgentCatalog>;

/**
 * The `Link` header on a dashboard document.
 *
 * Relative references survive the proxy that rewrites the host, and the
 * relation vocabulary is the registered one (`api-catalog`, `service-desc`,
 * `describedby`) plus the long-standing `alternate` for the sitemap.
 */
export const DASHBOARD_DISCOVERY_LINK = [
  `<${DASHBOARD_AUTH_PATH}>; rel="describedby"; type="text/markdown"`,
  `<${DASHBOARD_MCP_SERVER_CARD_PATH}>; rel="service-desc"; type="application/json"`,
  `<${DASHBOARD_API_CATALOG_PATH}>; rel="api-catalog"; type="application/linkset+json"`,
  `<${DASHBOARD_AGENT_CATALOG_PATH}>; rel="ai-catalog"; type="application/ai-catalog+json"`,
  `</sitemap.xml>; rel="alternate"; type="application/xml"`,
].join(", ");

/**
 * The full path for a splat captured by the `/.well-known/$` route.
 *
 * The splat is only the part after `/.well-known/`, so the prefix has to be
 * restored before the document switch can match a path constant.
 */
export const wellKnownPath = (splat: string | undefined) =>
  `/.well-known/${(splat ?? "").replace(/^\/+/u, "")}`;

/**
 * Whether the request asks for Markdown.
 *
 * Only an explicit `text/markdown` media range selects the Markdown document. A
 * wildcard does not: a browser sends `*` / `*` on a normal navigation, and
 * answering that with Markdown would replace the app for a person. A `q=0`
 * range is a refusal, not a request.
 */
export const acceptsMarkdown = (accept: string | null) => {
  if (accept === null) {
    return false;
  }

  for (const range of accept.split(",")) {
    const [type, ...parameters] = range.trim().split(";");

    if (type.trim().toLowerCase() !== "text/markdown") {
      continue;
    }

    // Parameter names are case-insensitive (RFC 9110), so `Q=0` is a refusal
    // for the same reason `q=0` is.
    const quality = parameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith("q="));

    if (quality === undefined) {
      return true;
    }

    const weight = Number.parseFloat(quality.slice(2));
    return Number.isFinite(weight) && weight > 0;
  }

  return false;
};
