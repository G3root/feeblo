import { expect, layer } from "@effect/vitest";
import { currentDb, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import { McpSchema } from "effect/ai";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { makePublicApiMcpRoute } from "./mcp";
import { PublicApiOperations } from "./operations";
import {
  PublicApiPostTags,
  PublicApiStatusList,
  PublicApiTagPage,
} from "./schema";
import {
  decodeError,
  POST_MANAGEMENT_KEY_SCOPES,
  PublicApiDependencies,
  registerKey,
  responseBody,
  seedTag,
  seedWorkspace,
  TAG_MANAGEMENT_KEY_SCOPES,
} from "./test-harness";

/**
 * The live MCP projection of the Public API.
 *
 * Drives `/mcp` through the production Streamable HTTP transport — initialize,
 * list, call — over the same real key, plan, and repository composition the
 * HTTP suite uses. The projection itself (tool/operation parity, annotations,
 * object-rooted input schemas) is pinned in `mcp.test.ts`; what these cover is
 * that a client's calls reach the same handlers through the same gate, and that
 * a refused call reads the same as it does on `/api/v1`.
 */

/** What a `POST /mcp` may ask for; the transport rejects a partial accept. */
const MCP_ACCEPT = "application/json, text/event-stream";

const executeMcp = (options: {
  readonly apiKey?: string;
  readonly body: unknown;
  readonly protocolVersion?: string;
  readonly sessionId?: string;
}) =>
  Effect.gen(function* () {
    const headers = new Headers({
      accept: MCP_ACCEPT,
      "content-type": "application/json",
    });
    if (options.apiKey !== undefined) {
      headers.set("x-api-key", options.apiKey);
    }
    if (options.protocolVersion !== undefined) {
      headers.set("mcp-protocol-version", options.protocolVersion);
    }
    if (options.sessionId !== undefined) {
      headers.set("mcp-session-id", options.sessionId);
    }

    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/mcp", {
        body: JSON.stringify(options.body),
        headers,
        method: "POST",
      })
    );
    const handled =
      yield* Deferred.make<HttpServerResponse.HttpServerResponse>();

    // `asHttpEffect` returns the route's response directly, but the MCP
    // transport attaches its session header in a pre-response handler, which
    // only the server loop applies. Running `HttpEffect.toHandled` keeps the
    // test on the production path, so the session a test continues with is the
    // one a real client would receive.
    yield* HttpEffect.toHandled(
      Effect.flatMap(HttpRouter.HttpRouter, (router) => router.asHttpEffect()),
      (_request, response) => Deferred.succeed(handled, response)
    ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request));

    return yield* Deferred.await(handled);
  });

/**
 * The JSON-RPC message a response carried.
 *
 * A single message is answered as JSON and a message surrounded by
 * notifications is streamed as Server-Sent Events; one reader handles both so a
 * test does not depend on which shape a given call takes.
 */
const decodeJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown)
);

const mcpMessage = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(async () => {
    const text = await HttpServerResponse.toWeb(response).text();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length));

    return decodeJson(events.at(-1) ?? text);
  });

const McpJsonRpcMessage = Schema.Struct({
  error: Schema.optional(
    Schema.Struct({ code: Schema.Number, message: Schema.String })
  ),
  id: Schema.Union([Schema.String, Schema.Number]),
  jsonrpc: Schema.Literal("2.0"),
  result: Schema.optional(Schema.Unknown),
});

const decodeMcpMessage = Schema.decodeUnknownSync(McpJsonRpcMessage);

/** The tools a `tools/list` answered with, validated by the protocol's own schema. */
const McpToolsList = Schema.Struct({
  tools: Schema.Array(McpSchema.Tool),
});

const decodeToolList = Schema.decodeUnknownSync(McpToolsList);

/** A tool-call result, decoded with the schema a client reads it with. */
const decodeCallToolResult = Schema.decodeUnknownSync(McpSchema.CallToolResult);

const MCP_PROTOCOL_VERSION = "2025-06-18";

const MCP_INITIALIZE = {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
    protocolVersion: MCP_PROTOCOL_VERSION,
  },
} as const;

/** Runs the handshake and returns the session a client would keep sending. */
const openMcpSession = (apiKey: string) =>
  Effect.gen(function* () {
    const initialized = yield* executeMcp({ apiKey, body: MCP_INITIALIZE });
    const sessionId = initialized.headers["mcp-session-id"];
    if (sessionId === undefined) {
      return yield* Effect.die("the MCP handshake did not open a session");
    }
    return sessionId;
  });

/** One `tools/call`, through the same session a client would use. */
const callTool = (
  sessionId: string,
  apiKey: string,
  name: string,
  toolArguments: Schema.JsonObject
) =>
  Effect.gen(function* () {
    const response = yield* executeMcp({
      apiKey,
      body: {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: toolArguments, name },
      },
      protocolVersion: MCP_PROTOCOL_VERSION,
      sessionId,
    });
    expect(response.status).toBe(200);

    const message = decodeMcpMessage(yield* mcpMessage(response));
    if (message.result === undefined) {
      return yield* Effect.die(
        `the tool call did not return a result: ${JSON.stringify(message.error)}`
      );
    }
    return decodeCallToolResult(message.result);
  });

layer(
  makePublicApiMcpRoute().pipe(
    Layer.provideMerge(PublicApiDependencies),
    Layer.provideMerge(HttpRouter.layer)
  )
)("public api mcp", (it) => {
  it.effect(
    "answers an initialize handshake and lists every operation as a tool",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey("fbk_mcp_list", workspace.organizationId);

        const initialized = yield* executeMcp({
          apiKey: "fbk_mcp_list",
          body: MCP_INITIALIZE,
        });
        expect(initialized.status).toBe(200);
        expect(initialized.headers["mcp-session-id"]).toBeDefined();

        const sessionId = yield* openMcpSession("fbk_mcp_list");
        const listed = yield* executeMcp({
          apiKey: "fbk_mcp_list",
          body: { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} },
          protocolVersion: MCP_PROTOCOL_VERSION,
          sessionId,
        });
        expect(listed.status).toBe(200);

        const message = decodeMcpMessage(yield* mcpMessage(listed));
        const tools = decodeToolList(message.result);
        expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
          PublicApiOperations.map((operation) => operation.name).sort()
        );

        // One tool checked against its operation: the descriptor is the same
        // description, annotations, and input schema the endpoint publishes,
        // so a client is not deciding with a second, thinner contract.
        const listTagsOperation = PublicApiOperations.find(
          (operation) => operation.name === "listTags"
        );
        const listTags = tools.tools.find((tool) => tool.name === "listTags");
        expect(listTags?.description).toBe(listTagsOperation?.description);
        expect(listTags?.annotations?.readOnlyHint).toBe(
          listTagsOperation?.annotations.readOnly
        );
        expect(listTags?.annotations?.idempotentHint).toBe(
          listTagsOperation?.annotations.idempotent
        );
        expect(Object.keys(listTags?.inputSchema.properties ?? {})).toEqual([
          "cursor",
          "limit",
        ]);
      })
  );

  it.effect("calls a read tool and returns its published page", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_call", workspace.organizationId);
      yield* seedTag(workspace.organizationId, "tag_mcp_read", "Bug");

      const sessionId = yield* openMcpSession("fbk_mcp_call");
      const result = yield* callTool(sessionId, "fbk_mcp_call", "listTags", {});
      expect(result.isError).toBe(false);

      const page = yield* Schema.decodeUnknownEffect(PublicApiTagPage)(
        result.structuredContent
      );
      expect(page.data.map((tag) => tag.name)).toEqual(["Bug"]);
    })
  );

  it.effect("writes through the same services the endpoints use", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedTag(workspace.organizationId, "tag_mcp_write", "Roadmap");
      registerKey(
        "fbk_mcp_write",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const sessionId = yield* openMcpSession("fbk_mcp_write");

      // A write that records a post's timeline entry needs the activity
      // repository, which none of the reads touch: this is the composition
      // check the read calls cannot make.
      const assigned = yield* callTool(
        sessionId,
        "fbk_mcp_write",
        "setPostTags",
        {
          postId: workspace.postId,
          tagIds: ["tag_mcp_write"],
        }
      );
      expect(assigned.isError).toBe(false);
      const tags = yield* Schema.decodeUnknownEffect(PublicApiPostTags)(
        assigned.structuredContent
      );
      expect(tags.data).toEqual([{ id: "tag_mcp_write", name: "Roadmap" }]);

      // A delete declares `Schema.Void`; the toolkit answers with no content
      // rather than a failure or an unencodable result.
      const deleted = yield* callTool(sessionId, "fbk_mcp_write", "deleteTag", {
        tagId: "tag_mcp_write",
      });
      expect(deleted.isError).toBe(false);
      expect(deleted.content).toEqual([]);

      // The write landed: the same side effect the endpoint produces.
      const db = yield* currentDb;
      const remaining = yield* db
        .select()
        .from(schema.tagTable)
        .where(eq(schema.tagTable.id, "tag_mcp_write"));
      expect(remaining).toHaveLength(0);
    })
  );

  it.effect("refuses a tool the key has no scope for", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_scope", workspace.organizationId, {
        boards: ["read"],
      });

      const sessionId = yield* openMcpSession("fbk_mcp_scope");
      const result = yield* callTool(
        sessionId,
        "fbk_mcp_scope",
        "listTags",
        {}
      );
      expect(result.isError).toBe(true);

      // The scope is a per-call failure, not a timeout or a protocol error: the
      // operation's own gate answered, and the server encoded its published
      // failure as the tool result's text, which is what a client shows its
      // model so it can pick a key that holds the scope.
      const [content] = result.content;
      if (content?.type !== "text") {
        return yield* Effect.die("the refusal carried no text content");
      }
      expect(content.text).toContain("tags.read");
    })
  );

  it.effect("rejects parameters the operation's schema refuses", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_invalid", workspace.organizationId);

      const sessionId = yield* openMcpSession("fbk_mcp_invalid");
      const response = yield* executeMcp({
        apiKey: "fbk_mcp_invalid",
        body: {
          id: 3,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: { limit: "many" }, name: "listTags" },
        },
        protocolVersion: MCP_PROTOCOL_VERSION,
        sessionId,
      });
      expect(response.status).toBe(200);

      // A parameter the tool's schema refuses is a protocol error, not an
      // `isError` result: the call never reached the operation, and a client
      // sees a failed call rather than a tool that answered it.
      const message = decodeMcpMessage(yield* mcpMessage(response));
      expect(message.result).toBeUndefined();
      expect(message.error?.code).toBe(-32_602);
    })
  );

  it.effect("refuses a create the operation's own constraints refuse", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_mcp_title",
        workspace.organizationId,
        POST_MANAGEMENT_KEY_SCOPES
      );

      const sessionId = yield* openMcpSession("fbk_mcp_title");
      const response = yield* executeMcp({
        apiKey: "fbk_mcp_title",
        body: {
          id: 3,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              boardId: workspace.boardId,
              content: "<p>body</p>",
              statusId: workspace.statusId,
              title: "x".repeat(201),
            },
            name: "createPost",
          },
        },
        protocolVersion: MCP_PROTOCOL_VERSION,
        sessionId,
      });
      expect(response.status).toBe(200);

      // The title's bound is the operation input's, not the HTTP payload's:
      // the tool refuses a create the endpoint would answer 400 for, so a
      // client cannot make a post the other surface rejects.
      const message = decodeMcpMessage(yield* mcpMessage(response));
      expect(message.result).toBeUndefined();
      expect(message.error?.code).toBe(-32_602);
    })
  );

  it.effect("calls a tool that takes no parameters", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_statuses", workspace.organizationId);

      const sessionId = yield* openMcpSession("fbk_mcp_statuses");
      const result = yield* callTool(
        sessionId,
        "fbk_mcp_statuses",
        "listStatuses",
        {}
      );
      expect(result.isError).toBe(false);

      // The empty input is an object schema rather than an empty struct: the
      // tool's `inputSchema` has to carry `type: "object"` for the transport
      // to accept the descriptor at all.
      const statuses = yield* Schema.decodeUnknownEffect(PublicApiStatusList)(
        result.structuredContent
      );
      expect(statuses.data.map((status) => status.id)).toEqual([
        workspace.statusId,
      ]);
      expect(statuses.data[0]?.name).toBe("Planned");
    })
  );

  it.effect("refuses a rolled-over date the same way HTTP does", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_date", workspace.organizationId);

      const sessionId = yield* openMcpSession("fbk_mcp_date");
      const result = yield* callTool(sessionId, "fbk_mcp_date", "listPosts", {
        updatedAfter: "2026-02-30",
      });
      expect(result.isError).toBe(true);

      // The operation validates the instant, not the HTTP projection, so the
      // tool refuses what the query parameter refuses: a date that does not
      // exist cannot be rolled into March on one surface and not the other.
      const [content] = result.content;
      if (content?.type !== "text") {
        return yield* Effect.die("the refusal carried no text content");
      }
      expect(content.text).toContain("ISO 8601");
    })
  );

  it.effect("refuses a request with no key", () =>
    Effect.gen(function* () {
      const response = yield* executeMcp({ body: MCP_INITIALIZE });
      expect(response.status).toBe(401);
      expect(decodeError(responseBody(response))._tag).toBe("MISSING_API_KEY");
    })
  );

  it.effect("refuses an unknown key", () =>
    Effect.gen(function* () {
      const response = yield* executeMcp({
        apiKey: "fbk_mcp_unknown",
        body: MCP_INITIALIZE,
      });
      expect(response.status).toBe(401);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_API_KEY");
    })
  );
});

/**
 * The `/mcp` key gate's rate-limit refusal.
 *
 * The HTTP suite has its own budget suite; this one pins that the MCP adapter
 * answers the header-wrapped `RATE_LIMITED` failure with the status and the
 * `Retry-After` header the contract promises, rather than a bare 500 or a body
 * without the header.
 */
layer(
  makePublicApiMcpRoute({ limit: 1, window: Duration.minutes(1) }).pipe(
    Layer.provideMerge(PublicApiDependencies),
    Layer.provideMerge(HttpRouter.layer)
  )
)("public api mcp rate limiting", (it) => {
  it.effect("returns 429 with Retry-After once the key's budget is spent", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_limited", workspace.organizationId);

      // The handshake is the key's one request; the call after it is the one
      // the budget refuses.
      const sessionId = yield* openMcpSession("fbk_mcp_limited");

      const refused = yield* executeMcp({
        apiKey: "fbk_mcp_limited",
        body: { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} },
        protocolVersion: MCP_PROTOCOL_VERSION,
        sessionId,
      });

      expect(refused.status).toBe(429);
      expect(decodeError(responseBody(refused))._tag).toBe("RATE_LIMITED");
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);

      // The MCP surface resolves the same key and publishes the same budget
      // headers, so a client pacing itself reads one contract on both.
      expect(refused.headers["x-ratelimit-limit"]).toBe("1");
      expect(refused.headers["x-ratelimit-remaining"]).toBe("0");
    })
  );
});
