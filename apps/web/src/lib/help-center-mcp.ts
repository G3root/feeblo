import type {
  THelpCenterArticlePublic,
  THelpCenterArticlePublicSummary,
} from "@feeblo/domain/help-center-article/schema";
import type { TSite } from "@feeblo/domain/site/schema";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readBoundedText } from "~/lib/bounded-body";

import {
  helpCenterMcpServerId,
  renderHelpCenterArticleIndex,
  renderHelpCenterArticleMarkdown,
} from "./help-center-agent";

/**
 * A keyless, read-only MCP server over one board's published help center.
 *
 * The protocol is small on purpose. The help center has two useful tools —
 * list the articles, read one — and a client that speaks Streamable HTTP can
 * call them with no credential. Every answer is built from the same public
 * projections the portal renders, so a draft cannot reach a tool any more than
 * it can reach a page.
 *
 * The transport is stateless: the server assigns no session id and answers a
 * single JSON body rather than an SSE stream. The Streamable HTTP transport
 * allows either, and stateless turns a per-tool call into one request with no
 * affinity to keep.
 */

/** The newest protocol revision this server implements. */
const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * The revisions whose request and response shapes this server knows.
 *
 * `initialize` echoes the client's revision when it is one of these. Echoing a
 * revision the server does not understand would promise a schema it will not
 * speak; an unknown revision gets the newest and the client decides whether it
 * can continue.
 */
const SUPPORTED_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);

/**
 * Bounds a tool call, not a page.
 *
 * The largest request this server takes is a slug inside a JSON-RPC envelope;
 * 64 KiB leaves room for a client's metadata and still refuses a body that was
 * meant to be an upload.
 */
const MAX_BODY_BYTES = 64 * 1024;

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

const MCP_TOOLS = [
  {
    name: "list_help_articles",
    description:
      "List every published article in this workspace's help center, grouped by section, with the Markdown URL for each one.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "get_help_article",
    description:
      "Read one published help center article as Markdown. Pass the slug returned by list_help_articles.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "The article's slug, as listed by list_help_articles.",
        },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
] as const;

const JsonRpcId = Schema.Union([Schema.String, Schema.Finite, Schema.Null]);

/** The envelope every request and response shares. */
const JsonRpcMessage = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(JsonRpcId),
  method: Schema.String,
  params: Schema.optional(Schema.JsonObject),
});

/** `initialize`'s only interesting field; every other one has a default. */
const InitializeParams = Schema.Struct({
  protocolVersion: Schema.optional(Schema.String),
});

const ToolCallParams = Schema.Struct({
  arguments: Schema.optional(Schema.JsonObject),
  name: Schema.String,
});

const ArticleSlugArguments = Schema.Struct({ slug: Schema.String });

type JsonRpcId = Schema.Schema.Type<typeof JsonRpcId>;

type JsonRpcRequest = Schema.Schema.Type<typeof JsonRpcMessage>;

type JsonObject = Schema.Schema.Type<typeof Schema.JsonObject>;

type JsonRpcError = {
  readonly code: number;
  readonly message: string;
};

type ToolTextContent = {
  readonly type: "text";
  readonly text: string;
};

type ToolCallResult = {
  readonly content: ReadonlyArray<ToolTextContent>;
  readonly isError?: boolean;
};

interface DispatchOk {
  readonly result: Schema.Json;
}

interface DispatchError {
  readonly error: JsonRpcError;
}

type DispatchResult = DispatchOk | DispatchError;

/**
 * What the protocol needs from the board.
 *
 * Functions rather than a client: the route resolves the site and owns the
 * RPC calls, so this module stays a protocol implementation that a test can
 * drive with two arrays.
 */
export interface HelpCenterMcpDependencies {
  readonly site: TSite;
  readonly origin: string;
  readonly listArticles: () => Promise<
    ReadonlyArray<THelpCenterArticlePublicSummary>
  >;
  readonly getArticle: (
    slug: string
  ) => Promise<THelpCenterArticlePublic | null>;
}

const jsonResponse = (body: Schema.Json, status = 200): Response =>
  new Response(JSON.stringify(body), { headers: JSON_HEADERS, status });

const rpcResult = (id: JsonRpcId, result: Schema.Json) => ({
  id,
  jsonrpc: "2.0" as const,
  result,
});

const rpcError = (id: JsonRpcId, error: JsonRpcError) => ({
  error,
  id,
  jsonrpc: "2.0" as const,
});

const toolError = (text: string): ToolCallResult => ({
  content: [{ text, type: "text" }],
  isError: true,
});

const toolText = (text: string): ToolCallResult => ({
  content: [{ text, type: "text" }],
});

/**
 * Reads a params object through a schema.
 *
 * Every branch of the protocol needs "an absent params is an empty object, and
 * a malformed one is the caller's problem", so the decode is one helper rather
 * than a `typeof` per field.
 */
const decodeParams =
  <A>(schema: Schema.Codec<A>) =>
  (params: JsonObject | undefined) => {
    const decoded = Schema.decodeUnknownOption(schema)(params ?? {});

    return Option.isSome(decoded) ? decoded.value : undefined;
  };

const negotiateInitialization = (
  params: JsonObject | undefined,
  site: TSite
): DispatchResult => {
  const requested = decodeParams(InitializeParams)(params)?.protocolVersion;

  const protocolVersion =
    requested !== undefined && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
      ? requested
      : MCP_PROTOCOL_VERSION;

  return {
    result: {
      capabilities: { tools: {} },
      instructions:
        "Read this workspace's published help center. Call list_help_articles for the index, then get_help_article with a slug to read one article. Every answer is public and needs no credential.",
      protocolVersion,
      serverInfo: { name: helpCenterMcpServerId(site), version: "1.0.0" },
    },
  };
};

const callTool = async (
  params: JsonObject | undefined,
  dependencies: HelpCenterMcpDependencies
): Promise<DispatchResult> => {
  const decoded = decodeParams(ToolCallParams)(params);

  if (decoded === undefined) {
    return {
      error: {
        code: -32602,
        message: "tools/call requires a tool name and an arguments object.",
      },
    };
  }

  const args = decoded.arguments ?? {};

  switch (decoded.name) {
    case "list_help_articles": {
      let articles: ReadonlyArray<THelpCenterArticlePublicSummary>;

      try {
        articles = await dependencies.listArticles();
      } catch {
        // A dependency failure is a tool execution error, not a malformed
        // JSON-RPC request: the client should see an `isError` result it can
        // report, while the outer handler keeps the protocol-level fallback.
        return { result: toolError("The help center is unavailable.") };
      }

      return {
        result: toolText(
          renderHelpCenterArticleIndex(
            dependencies.site,
            articles,
            dependencies.origin
          )
        ),
      };
    }

    case "get_help_article": {
      const slug = decodeParams(ArticleSlugArguments)(args)?.slug.trim() ?? "";

      if (slug === "") {
        return {
          error: {
            code: -32602,
            message: "get_help_article requires a non-empty slug.",
          },
        };
      }

      let article: THelpCenterArticlePublic | null;

      try {
        article = await dependencies.getArticle(slug);
      } catch {
        return { result: toolError("The help center is unavailable.") };
      }

      return {
        result:
          article === null
            ? toolError(`No published article has the slug "${slug}".`)
            : toolText(
                renderHelpCenterArticleMarkdown(article, dependencies.origin)
              ),
      };
    }

    default:
      return {
        error: {
          code: -32602,
          message: `Unknown tool: ${decoded.name}`,
        },
      };
  }
};

const dispatch = async (
  method: string,
  params: JsonObject | undefined,
  dependencies: HelpCenterMcpDependencies
): Promise<DispatchResult> => {
  switch (method) {
    case "initialize":
      return negotiateInitialization(params, dependencies.site);

    case "ping":
      return { result: {} };

    case "tools/list":
      return { result: { tools: MCP_TOOLS } };

    case "tools/call":
      return callTool(params, dependencies);

    default:
      return {
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
};

type DecodedMessage =
  | { readonly kind: "parse-error" }
  | { readonly kind: "invalid-request" }
  | { readonly kind: "message"; readonly message: JsonRpcRequest };

/**
 * Rejects a protocol revision this server does not speak.
 *
 * After `initialize`, the transport carries the negotiated revision on every
 * request. An unsupported one is a transport-level mismatch, not a JSON-RPC
 * error: answer 400 so the client reconnects instead of parsing a body it may
 * not understand. An absent header keeps the documented fallback.
 */
const protocolVersionError = (request: Request): Response | undefined => {
  const version = request.headers.get("mcp-protocol-version");

  if (version === null || SUPPORTED_PROTOCOL_VERSIONS.has(version)) {
    return undefined;
  }

  return new Response("Unsupported MCP-Protocol-Version", { status: 400 });
};

const decodeMessage = (body: string): DecodedMessage => {
  const json = Schema.decodeOption(Schema.fromJsonString(Schema.Json))(body);

  if (Option.isNone(json)) {
    return { kind: "parse-error" };
  }

  const message = Schema.decodeUnknownOption(JsonRpcMessage)(json.value);

  return Option.isSome(message)
    ? { kind: "message", message: message.value }
    : { kind: "invalid-request" };
};

/**
 * Answers one JSON-RPC message.
 *
 * A notification (a request with no `id`) is accepted and answered with `202`
 * and no body, which is what the transport expects for
 * `notifications/initialized` and `notifications/cancelled`.
 */
export async function handleHelpCenterMcp({
  dependencies,
  request,
}: {
  readonly dependencies: HelpCenterMcpDependencies;
  readonly request: Request;
}): Promise<Response> {
  const requestOrigin = request.headers.get("origin");

  // The transport is not cross-origin: a browser client on another site has no
  // business driving this server, and refusing the `Origin` header is the
  // DNS-rebinding defense the MCP specification asks for. Desktop and server
  // clients send no `Origin` and are unaffected.
  if (requestOrigin !== null && requestOrigin !== new URL(request.url).origin) {
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") {
    return new Response(null, {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const versionError = protocolVersionError(request);

  if (versionError !== undefined) {
    return versionError;
  }

  const body = await readBoundedText(request, MAX_BODY_BYTES);

  if (body === undefined) {
    return new Response("Payload too large", { status: 413 });
  }

  const decoded = decodeMessage(body);

  if (decoded.kind === "parse-error") {
    return jsonResponse(
      rpcError(null, { code: -32700, message: "Parse error" })
    );
  }

  if (decoded.kind === "invalid-request") {
    return jsonResponse(
      rpcError(null, { code: -32600, message: "Invalid Request" })
    );
  }

  const { message } = decoded;

  const id = message.id ?? null;
  const isNotification = message.id === undefined;

  let outcome: DispatchResult;

  try {
    outcome = await dispatch(message.method, message.params, dependencies);
  } catch {
    // A failed RPC or an unreachable API is not a protocol error in the
    // client's request, so it is reported as a server error and the client can
    // decide whether to retry.
    outcome = {
      error: {
        code: -32603,
        message: "The help center is unavailable.",
      },
    };
  }

  if (isNotification) {
    return new Response(null, { status: 202 });
  }

  return "error" in outcome
    ? jsonResponse(rpcError(id, outcome.error))
    : jsonResponse(rpcResult(id, outcome.result));
}
