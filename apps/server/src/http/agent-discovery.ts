import { PUBLIC_API_MCP_PATH } from "@feeblo/domain/public-api/mcp";
import { PUBLIC_API_KEY_HEADER } from "@feeblo/domain/public-api/middleware";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/**
 * The agent and crawler discovery documents served by the API origin.
 *
 * A person reaching `api.feeblo.com` in a browser needs the reference page; an
 * agent arriving without one needs to know where the contract, the credential,
 * and the MCP transport are before it can call anything. These routes answer
 * that question from the same origin the API is served from, following the
 * discovery set rat-stack documents: a Markdown landing page, `/auth.md`,
 * `/llms.txt`, an RFC 9727 API catalog, and an MCP server card.
 *
 * The documents are derived from the request's origin, so a self-hosted
 * deployment and a preview environment advertise themselves rather than
 * feeblo.com. They name no internal module and read no database: a discovery
 * request costs one static response and cannot fail on a degraded dependency,
 * which is what lets a crawler retry it during an incident.
 */

export const API_VERSION_PATH = "/api/v1";
export const API_OPENAPI_PATH = `${API_VERSION_PATH}/openapi.json`;
export const API_REFERENCE_PATH = `${API_VERSION_PATH}/docs`;
export const AGENT_AUTH_PATH = "/auth.md";
export const AGENT_LLMS_PATH = "/llms.txt";
export const API_CATALOG_PATH = "/.well-known/api-catalog";
export const MCP_SERVER_CARD_PATH = "/.well-known/mcp.json";

const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MARKDOWN_LINK_TYPE = "text/markdown";
const TEXT_LINK_TYPE = "text/plain";
const JSON_LINK_TYPE = "application/json";
const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';
const API_CATALOG_LINK_TYPE = "application/linkset+json";

/**
 * The origin the discovery documents advertise.
 *
 * Effect's server request carries a relative URL, so the origin is rebuilt
 * from the proxy headers when they are present and from `Host` otherwise. A
 * self-hosted deployment and a preview host therefore advertise themselves
 * rather than feeblo.com. `x-forwarded-host` wins because a proxy that rewrites
 * the internal host is the case where `Host` is already the upstream name. The
 * fallback is the hosted API origin, not a placeholder: a document that
 * advertises `http://localhost` in production is worse than one that advertises
 * the canonical host.
 */
export const discoveryOrigin = (
  request: HttpServerRequest.HttpServerRequest
) => {
  const url = new URL(request.url, "https://api.feeblo.com");

  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(request.url)) {
    return url.origin;
  }

  const host = request.headers["x-forwarded-host"] ?? request.headers.host;

  if (host === undefined || host === "") {
    return url.origin;
  }

  const forwardedProto = request.headers["x-forwarded-proto"]
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const localHost =
    host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : localHost
        ? "http"
        : "https";

  return `${protocol}://${host}`;
};

/**
 * The `Link` header every discovery response carries.
 *
 * Relative references are preferred by RFC 8288 and survive a proxy that
 * rewrites the host. `api-catalog` is the registered relation RFC 9727 defines;
 * `service-desc` and `service-doc` are the linkset vocabulary the catalog uses.
 */
const discoveryLinkHeader = [
  `</.well-known/api-catalog>; rel="api-catalog"; type="${API_CATALOG_LINK_TYPE}"`,
  `<${API_OPENAPI_PATH}>; rel="service-desc"; type="${JSON_LINK_TYPE}"`,
  `<${API_REFERENCE_PATH}>; rel="service-doc"; type="text/html"`,
  `<${PUBLIC_API_MCP_PATH}>; rel="service-desc"; type="${JSON_LINK_TYPE}"`,
  `</.well-known/mcp.json>; rel="service-desc"; type="${JSON_LINK_TYPE}"`,
  `<${AGENT_AUTH_PATH}>; rel="describedby"; type="${MARKDOWN_LINK_TYPE}"`,
  `<${AGENT_LLMS_PATH}>; rel="describedby"; type="${TEXT_LINK_TYPE}"`,
].join(", ");

const discoveryResponse = (body: string, contentType: string, extraLink = "") =>
  HttpServerResponse.text(body, {
    contentType,
    headers: {
      // The body names the origin it was requested from, so a shared cache
      // must not pin one caller's Host or forwarded host onto the canonical
      // URL. These documents are cheap to regenerate.
      "Cache-Control": "no-store",
      Link:
        extraLink === ""
          ? discoveryLinkHeader
          : `${discoveryLinkHeader}, ${extraLink}`,
    },
  });

/**
 * The Markdown document served at `/` and `/llms.txt`.
 *
 * Written for a model that has one page of context to work with: what the
 * origin is, which credential it needs, where the contract lives, and what it
 * must not do without a person's approval.
 */
export const apiMarkdown = (origin: string) => `# Feeblo Public API

> The versioned HTTP and MCP surface for one Feeblo workspace: posts, comments,
> votes, tags, boards, changelog entries, companies, and end users. Every
> response is JSON and every request carries a workspace API key.

- Base URL: ${origin}${API_VERSION_PATH}
- OpenAPI 3.1 document: ${origin}${API_OPENAPI_PATH}
- Reference page: ${origin}${API_REFERENCE_PATH} (readable without a key)
- MCP endpoint: ${origin}${PUBLIC_API_MCP_PATH} (streamable HTTP)
- Authentication guide: ${origin}${AGENT_AUTH_PATH}
- API catalog: ${origin}${API_CATALOG_PATH}
- MCP server card: ${origin}${MCP_SERVER_CARD_PATH}

## Authenticate

Send a workspace API key in the \`${PUBLIC_API_KEY_HEADER}\` header:

\`\`\`sh
curl ${origin}${API_VERSION_PATH}/boards \\
  -H "${PUBLIC_API_KEY_HEADER}: fbk_..."
\`\`\`

A workspace admin or owner creates keys in the dashboard under
**Settings → Developers**. The plaintext key is shown once, starts with
\`fbk_\`, and is bound to the workspace that owns it. The Public API is included
in the Starter and Professional plans.

A key is created with a fixed scope set and cannot be widened. A missing scope
answers \`403 FORBIDDEN_SCOPE\`; a missing or invalid key answers \`401\`; a
workspace plan without the Public API answers \`403 PLAN_REQUIRES_UPGRADE\`. The
per-key budget is 300 requests per minute and is reported in
\`X-RateLimit-*\` headers. Switch on the error \`_tag\`, never on \`message\`.

## Use MCP

Point a streamable-HTTP MCP client at ${origin}${PUBLIC_API_MCP_PATH} and send
the same key in the \`${PUBLIC_API_KEY_HEADER}\` header. Every operation in the
OpenAPI document is one tool with the same input schema, result, and scope. A
key that lacks a scope still lists the tool and receives a tool error naming the
missing scope when it calls it. The transport refuses requests carrying an
\`Origin\` header; a browser client needs a same-origin proxy.

## Read the docs

- Public API guide: https://docs.feeblo.com/developers/public-api
- MCP guide: https://docs.feeblo.com/developers/mcp
- Documentation index: https://docs.feeblo.com/llms.txt
- Documentation MCP server, no key required: https://docs.feeblo.com/mcp
- Agent authentication guide: https://feeblo.com/auth.md

## Safety

Reads are safe. Creating, updating, deleting, merging, voting, or publishing
changes a real workspace. Show the person the exact request and the affected
records, then wait for approval before a write. Publishing a changelog entry
emails every subscriber.
`;

/**
 * `/auth.md` — the credential instructions an agent reads before it calls.
 *
 * Kept on the API origin as well as the marketing site because an agent that
 * finds the API through its OpenAPI document never visits feeblo.com. Both
 * copies are hand-written; a change to the header, the key format, the scopes,
 * or the MCP setup belongs in both.
 */
export const authMarkdown = (origin: string) => `# Authentication for agents

Feeblo's machine surfaces accept exactly one credential: a workspace API key.
Never ask a person for a password, a session cookie, or a better-auth token.

## Create a key

1. Open the dashboard for the workspace: https://app.feeblo.com.
2. Go to **Settings → Developers**.
3. Create a key and choose the capabilities the integration needs. The scopes
   are fixed at creation and cannot be widened later.
4. Copy the plaintext key. It is shown once, starts with \`fbk_\`, and cannot be
   retrieved again.

The Public API is included in the Starter and Professional plans. A Free
workspace cannot create keys. Existing keys survive a downgrade and work again
after an upgrade.

## Call the API

Send the key in the \`${PUBLIC_API_KEY_HEADER}\` header:

\`\`\`sh
curl ${origin}${API_VERSION_PATH}/boards \\
  -H "${PUBLIC_API_KEY_HEADER}: fbk_..."
\`\`\`

A failure carries a machine-readable \`_tag\`:

\`\`\`json
{ "_tag": "FORBIDDEN_SCOPE", "message": "This API key is missing the posts.create scope." }
\`\`\`

| Status | \`_tag\` | Meaning |
| --- | --- | --- |
| 401 | \`MISSING_API_KEY\` | No \`${PUBLIC_API_KEY_HEADER}\` header, or an empty one. |
| 401 | \`INVALID_API_KEY\` | Unknown, revoked, expired, or disabled key. |
| 403 | \`FORBIDDEN_SCOPE\` | The key lacks the scope the endpoint requires. |
| 403 | \`PLAN_REQUIRES_UPGRADE\` | The workspace plan does not include the Public API. |
| 404 | \`NOT_FOUND\` | The record does not exist in this workspace. |
| 409 | \`CONFLICT\` | The write conflicts with the current state. |
| 429 | \`RATE_LIMITED\` | The per-key budget is exhausted; read \`Retry-After\`. |
| 500 | \`INTERNAL_ERROR\` | Unexpected server failure. |
| 503 | \`SERVICE_UNAVAILABLE\` | A required dependency is unavailable; requests fail closed. |

The per-key budget is 300 requests per minute, shared by reads, writes, and MCP
calls. A response carries \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, and
\`X-RateLimit-Reset\`.

## Connect an MCP client

Use the same key. There is no OAuth flow and no separate MCP credential.

\`\`\`json
{
  "mcpServers": {
    "feeblo": {
      "type": "http",
      "url": "${origin}${PUBLIC_API_MCP_PATH}",
      "headers": {
        "${PUBLIC_API_KEY_HEADER}": "fbk_..."
      }
    }
  }
}
\`\`\`

Supported protocol revisions: \`2026-07-28\`, \`2025-11-25\`, \`2025-06-18\`,
\`2025-03-26\`, and \`2024-11-05\`. Requests carrying an \`Origin\` header are
refused, so a browser client needs a same-origin proxy.

## Read without a key

- API reference: ${origin}${API_REFERENCE_PATH}
- OpenAPI document: ${origin}${API_OPENAPI_PATH}
- Public API guide: https://docs.feeblo.com/developers/public-api
- MCP guide: https://docs.feeblo.com/developers/mcp
- Documentation index: https://docs.feeblo.com/llms.txt
- Machine-readable surfaces: https://feeblo.com/agent-readability.json

## Ask before writing

Reading is safe. Creating, updating, deleting, merging, voting, or publishing
changes a real workspace. Show the person the exact endpoint, the body, and the
affected records, then wait for approval before sending it. Publishing a
changelog entry emails every subscriber, so treat it as an announcement rather
than a save.
`;

/**
 * RFC 9727 API catalog for the HTTP API and the MCP transport.
 *
 * `anchor` names the resource, `service-desc` points at the machine contract,
 * and `service-doc` points at human documentation. The MCP entry's contract is
 * the server card rather than the OpenAPI document because an MCP client reads
 * a server card, not an OpenAPI document.
 */
export const apiCatalog = (origin: string) => ({
  linkset: [
    {
      anchor: `${origin}${API_VERSION_PATH}`,
      "service-desc": [
        {
          href: `${origin}${API_OPENAPI_PATH}`,
          type: "application/json",
        },
      ],
      "service-doc": [
        {
          href: `${origin}${API_REFERENCE_PATH}`,
          type: "text/html",
        },
        {
          href: "https://docs.feeblo.com/developers/public-api",
          type: "text/html",
        },
        {
          href: "https://docs.feeblo.com/developers/public-api.md",
          type: "text/markdown",
        },
      ],
      "service-meta": [
        {
          href: `${origin}${AGENT_AUTH_PATH}`,
          type: "text/markdown",
        },
      ],
    },
    {
      anchor: `${origin}${PUBLIC_API_MCP_PATH}`,
      "service-desc": [
        {
          href: `${origin}${MCP_SERVER_CARD_PATH}`,
          type: "application/json",
        },
      ],
      "service-doc": [
        {
          href: "https://docs.feeblo.com/developers/mcp",
          type: "text/html",
        },
        {
          href: `${origin}${AGENT_AUTH_PATH}`,
          type: "text/markdown",
        },
      ],
    },
  ],
});

/**
 * The MCP server card served at `/.well-known/mcp.json`.
 *
 * The `servers` shape is the one the Feeblo docs site already publishes, so a
 * client that learned to read one Feeblo origin reads the others without a
 * second parser. `authentication` is where the key requirement is stated: a
 * client that guesses an unauthenticated server would fail on its first call.
 */
export const mcpServerCard = (origin: string) => ({
  servers: [
    {
      name: "Feeblo Public API",
      description:
        "Read and manage one Feeblo workspace's posts, comments, votes, tags, boards, changelog entries, companies, and end users. Requires a workspace API key.",
      transport: "streamable-http",
      url: `${origin}${PUBLIC_API_MCP_PATH}`,
      authentication: {
        required: true,
        scheme: PUBLIC_API_KEY_HEADER,
        documentation: `${origin}${AGENT_AUTH_PATH}`,
      },
      documentation: "https://docs.feeblo.com/developers/mcp",
    },
  ],
});

const route = (
  router: HttpRouter.HttpRouter,
  path: HttpRouter.PathInput,
  handler: (
    request: HttpServerRequest.HttpServerRequest
  ) => HttpServerResponse.HttpServerResponse
) => router.add("GET", path, (request) => Effect.succeed(handler(request)));

/**
 * The discovery routes as one layer.
 *
 * `RootRouter` used to answer `/` with `Hello world`; this replaces it, because
 * the API origin's root is the first page an agent can reach and it should name
 * the contract instead of greeting nobody in particular.
 */
export const AgentDiscoveryRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* route(router, "/", (request) =>
      discoveryResponse(
        apiMarkdown(discoveryOrigin(request)),
        MARKDOWN_CONTENT_TYPE
      )
    );
    yield* route(router, AGENT_LLMS_PATH, (request) =>
      discoveryResponse(
        apiMarkdown(discoveryOrigin(request)),
        TEXT_CONTENT_TYPE
      )
    );
    yield* route(router, AGENT_AUTH_PATH, (request) =>
      discoveryResponse(
        authMarkdown(discoveryOrigin(request)),
        MARKDOWN_CONTENT_TYPE
      )
    );
    yield* route(router, API_CATALOG_PATH, (request) =>
      discoveryResponse(
        JSON.stringify(apiCatalog(discoveryOrigin(request)), null, 2),
        API_CATALOG_CONTENT_TYPE,
        `</${AGENT_AUTH_PATH}>; rel="describedby"; type="${MARKDOWN_LINK_TYPE}"`
      )
    );
    yield* route(router, MCP_SERVER_CARD_PATH, (request) =>
      discoveryResponse(
        JSON.stringify(mcpServerCard(discoveryOrigin(request)), null, 2),
        JSON_CONTENT_TYPE,
        `</${AGENT_AUTH_PATH}>; rel="describedby"; type="${MARKDOWN_LINK_TYPE}"`
      )
    );
  })
);
