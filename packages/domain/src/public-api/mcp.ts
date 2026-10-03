import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type { unhandled } from "effect/Types";

import { Auth } from "../auth-handler";
import { PublicApiChangelogRepository } from "../changelog/public-api/repository";
import { PublicApiCommentRepository } from "../comments/public-api/repository";
import { CommentService } from "../comments/service";
import { EntitlementPolicy } from "../entitlement/policies";
import { PublicApiPostRepository } from "../post/public-api/repository";
import { RateLimitService } from "../rate-limit/service";
import { PublicApiVoteRepository } from "../upvote/public-api/repository";
import {
  authenticatePublicApiKey,
  type PublicApiAuthenticationFailure,
  type PublicApiKeyBudget,
  publicApiRateLimitHeaders,
} from "./api-key-auth";
import {
  InternalError,
  internalError,
  InvalidApiKeyError,
  MissingApiKeyError,
  PlanRequiresUpgradeError,
  RateLimitedError,
  ServiceUnavailableError,
} from "./errors";
import {
  PUBLIC_API_KEY_HEADER,
  PublicApiCaller,
  PUBLIC_API_KEY_RATE_LIMIT,
} from "./middleware";
import { PublicApiOperations } from "./operations";
import { PublicApiInternals } from "./router";

/**
 * The Model Context Protocol projection of the Public API.
 *
 * `/mcp` is a second surface over the same operations the `/api/v1` endpoints
 * serve (ADR 0007): a tool is `Tool.make`d from the operation's own schemas and
 * annotations, and its handler is the operation's own handler — so a client
 * cannot receive a different answer for the same call than the HTTP surface
 * does, and neither surface owns the behavior.
 *
 * The key is the Public API key, resolved by the same
 * `authenticatePublicApiKey` the HTTP middleware calls: presence, verification,
 * the per-key budget, and the plan gate are one implementation, and the caller
 * it returns is provided to the tool handlers. The operation still enforces its
 * own scope (`defineOperation` wraps every handler), so a key that lacks a
 * scope sees the tool but is refused when it calls it.
 */

/** Where the Streamable HTTP transport is mounted on the server. */
export const PUBLIC_API_MCP_PATH = "/mcp";

const MCP_SERVER_NAME = "feeblo";

/**
 * The server instructions a client shows its model.
 *
 * Kept to the facts a model needs to use the tools: everything is scoped to the
 * key's workspace, and a forbidden scope is a scope problem rather than a
 * missing capability.
 */
const MCP_SERVER_INSTRUCTIONS =
  "Read and write the calling workspace's Feeblo posts, comments, votes, tags, companies, and changelog entries. Every tool is scoped to the workspace that owns the presented API key, and a tool the key's scopes do not cover answers FORBIDDEN_SCOPE.";

/**
 * The protocol revisions the transport serves.
 *
 * Newest first: the first stateful revision is the fallback when a client does
 * not name one, and every revision a current client might offer is present so a
 * connection is not refused for a version mismatch that has a schema for it.
 */
const MCP_PROTOCOLS = [
  McpProtocol.v2026_07_28,
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18,
  McpProtocol.v2025_03_26,
  McpProtocol.v2024_11_05,
] as const;

/**
 * The registry's element type, with the schemas each member declares.
 *
 * `PublicApiOperations` is `as const`, so the union is precise: it is what lets
 * the projection read an operation's schemas and annotations without a cast,
 * and what `docs/adr/0007` means by "the operation is the unit".
 */
type PublicApiOperationUnion = (typeof PublicApiOperations)[number];

/**
 * One operation as one tool.
 *
 * Everything a client decides with comes from the operation: the name and
 * description it lists, the input and output schemas it validates against, the
 * failure vocabulary a declared failure is encoded with, and the annotations it
 * shows in an approval prompt. `Tool.make` is the declaration the MCP server
 * reads, so the HTTP endpoint and the tool cannot disagree about any of them,
 * and the toolkit decodes a call's parameters and encodes its success and
 * declared failures without a line of surface-specific code.
 */
const toMcpTool = (operation: PublicApiOperationUnion) =>
  Tool.make(operation.name, {
    description: operation.description,
    failure: operation.failure,
    parameters: operation.input,
    success: operation.output,
  })
    .annotate(Tool.Readonly, operation.annotations.readOnly)
    .annotate(Tool.Destructive, operation.annotations.destructive)
    .annotate(Tool.Idempotent, operation.annotations.idempotent)
    .annotate(Tool.OpenWorld, operation.annotations.openWorld);

/**
 * Every operation, as one toolkit.
 *
 * The registry is the iteration, so a tool cannot exist without an HTTP
 * endpoint or the reverse: `operations.test.ts` pins the registry to the
 * published endpoint set, and `McpServer.toolkit` registers this projection of
 * it. Adding an operation is therefore a tool on both surfaces at once, with no
 * edit here.
 */
export const PublicApiMcpToolkit = Toolkit.make(
  ...PublicApiOperations.map(toMcpTool)
);

type PublicApiMcpTools = typeof PublicApiMcpToolkit.tools;

/**
 * The handlers the toolkit calls for each tool.
 *
 * The toolkit does the surface work — decoding parameters with the tool's own
 * schema, encoding the success, encoding a declared failure as an `isError`
 * result, and answering a parameter the schema rejects as a protocol error —
 * so what is left is the operation's handler, keyed by its tool name.
 */
const buildPublicApiMcpHandlers =
  (): Toolkit.HandlersFrom<PublicApiMcpTools> => {
    const handlers: Record<
      string,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The registry erases each operation's input to `unknown` (ADR 0007), and a record keyed by tool name cannot name one input type per key; the toolkit decodes a call's parameters with the operation's own schema before this handler runs, which is what turns the erased input back into the operation's input type.
      (parameters: unknown) => Effect.Effect<unknown, unknown, never>
    > = {};

    for (const operation of PublicApiOperations) {
      // SAFETY: the erasure above, narrowed back for the cast. The handler is the
      // operation's own, so the value the toolkit decodes with `operation.input`
      // is exactly what it accepts.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      handlers[operation.name] = operation.handler as (
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- See the record's comment: this is the erased view of the operation's own input type.
        input: unknown
      ) => Effect.Effect<unknown, unknown, never>;
    }

    // SAFETY: the record is built from the same registry that produced the
    // toolkit, so it is keyed by exactly the toolkit's tool names and holds one
    // handler per tool. A loop over a heterogeneous array cannot carry that
    // mapping in its type, which is the one thing this assertion restores; the
    // intermediate `unknown` is what lets the assertion pass the compiler's
    // overlap check at all.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- See the SAFETY comment: the erased record is exactly the toolkit's handler map, and a single assertion cannot convert between the index signature and the mapped type.
    return handlers as unknown as Toolkit.HandlersFrom<PublicApiMcpTools>;
  };

const PublicApiMcpHandlers = PublicApiMcpToolkit.toLayer(
  buildPublicApiMcpHandlers()
);

/**
 * The status the Public API publishes for each authentication failure.
 *
 * Read from each schema's own `httpApiStatus` annotation — the same one
 * `OpenApi.fromApi` reads for `/api/v1` — rather than restated as a second
 * table, so the MCP surface cannot answer a key refusal with a different status
 * than the HTTP surface does. The list is the failure union
 * `authenticatePublicApiKey` declares.
 */
const AUTHENTICATION_FAILURE_SCHEMAS = [
  MissingApiKeyError,
  InvalidApiKeyError,
  PlanRequiresUpgradeError,
  RateLimitedError,
  InternalError,
  ServiceUnavailableError,
] as const;

/** The failures above, as the values the key check answers with. */
type PublicApiAuthenticationError =
  (typeof AUTHENTICATION_FAILURE_SCHEMAS)[number]["Type"];

const AuthenticationError = Schema.Union([...AUTHENTICATION_FAILURE_SCHEMAS]);

const decodeAuthenticationError =
  Schema.decodeUnknownOption(AuthenticationError);

/** The annotation key `HttpApiSchema.status` writes; not re-exported as a constant. */
const HTTP_API_STATUS_ANNOTATION = "httpApiStatus";

const failureStatus = (failure: PublicApiAuthenticationError): number => {
  for (const schema of AUTHENTICATION_FAILURE_SCHEMAS) {
    if (Schema.is(schema)(failure)) {
      return (
        SchemaAST.resolveAt<number>(HTTP_API_STATUS_ANNOTATION)(schema.ast) ??
        500
      );
    }
  }
  return 500;
};

/**
 * A `RATE_LIMITED` failure carries its `Retry-After` header on a `WithHeaders`
 * wrapper around the error; this decodes that wrapper so the response can send
 * the header and the status/body it belongs to.
 */
const WithHeadersFailure = Schema.Struct({
  [HttpApiSchema.WithHeadersValueTypeId]: Schema.Literal(
    HttpApiSchema.WithHeadersValueTypeId
  ),
  body: AuthenticationError,
  headers: Schema.Record(Schema.String, Schema.String),
});

const decodeWithHeadersFailure = Schema.decodeUnknownOption(WithHeadersFailure);

/**
 * Answers a refused request with the `/api/v1` envelope and status.
 *
 * A client configuring `/mcp` is configuring the same key as the HTTP API, so a
 * missing key, a bad one, an exhausted budget, or a plan that does not include
 * the Public API reads the same here as there.
 */
const publicApiFailureResponse = (
  failure: PublicApiAuthenticationFailure
): HttpServerResponse.HttpServerResponse => {
  const withHeaders = decodeWithHeadersFailure(failure);
  const body = Option.isSome(withHeaders)
    ? withHeaders.value.body
    : Option.getOrElse(decodeAuthenticationError(failure), () =>
        internalError()
      );
  const headers = Option.isSome(withHeaders) ? withHeaders.value.headers : {};

  return HttpServerResponse.jsonUnsafe(
    { _tag: body._tag, message: body.message },
    { headers, status: failureStatus(body) }
  );
};

/**
 * The key gate for `/mcp`.
 *
 * A route middleware rather than an `HttpApiMiddleware` because the MCP
 * transport registers its own `HttpRouter` route; it calls the same
 * `authenticatePublicApiKey`, so the two surfaces cannot drift into different
 * key, budget, or plan behavior. The `McpServer` layer is responsible for
 * origin and protocol checks; authentication runs first, so an unauthenticated
 * request never reaches JSON-RPC parsing.
 */
const makePublicApiMcpKeyMiddleware = (budget: PublicApiKeyBudget) =>
  HttpRouter.middleware(
    Effect.gen(function* () {
      // The services the key check needs are resolved once, when the route is
      // built, and supplied to each request's check below. That is what lets
      // this middleware take no request-time requirements of its own, which is
      // the form a route-scoped `HttpRouter` middleware can be provided in.
      const auth = yield* Auth;
      const entitlementPolicy = yield* EntitlementPolicy;
      const rateLimitService = yield* RateLimitService;

      return (
        httpEffect: Effect.Effect<
          HttpServerResponse.HttpServerResponse,
          unhandled,
          never
        >
      ) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const presented = (
            request.headers[PUBLIC_API_KEY_HEADER] ?? ""
          ).trim();

          return yield* authenticatePublicApiKey(presented, budget).pipe(
            Effect.provideService(Auth, auth),
            Effect.provideService(EntitlementPolicy, entitlementPolicy),
            Effect.provideService(RateLimitService, rateLimitService),
            Effect.matchEffect({
              onFailure: (failure) =>
                Effect.succeed(publicApiFailureResponse(failure)),
              onSuccess: (call) =>
                Effect.gen(function* () {
                  // The same `X-RateLimit-*` headers the HTTP surface sends,
                  // for the same reason: a client pacing itself should not
                  // have to learn the budget from a 429.
                  const now = yield* Clock.currentTimeMillis;
                  const headers = publicApiRateLimitHeaders(
                    call.rateLimit,
                    now
                  );
                  return yield* httpEffect.pipe(
                    Effect.provideService(PublicApiCaller, call),
                    Effect.map((response) =>
                      HttpServerResponse.setHeaders(response, headers)
                    )
                  );
                }),
            })
          );
        });
    })
  ).layer;

/**
 * The layers the MCP route's own reads and writes need.
 *
 * The same bundle the HTTP route composes: the shared feature repositories come
 * from `PublicApiInternals`, and the public projections (the reads that must
 * not select actor identifiers, the changelog publication orchestration) and
 * the dashboard comment write path are built on top of it. Constructed here
 * rather than imported from `router.ts` so each surface owns its composition
 * (ADR 0006) and adding a public projection to MCP is an edit in one file.
 */
const PublicApiMcpRepositories = Layer.mergeAll(
  PublicApiChangelogRepository.layer,
  PublicApiCommentRepository.layer,
  PublicApiPostRepository.layer,
  PublicApiVoteRepository.layer,
  CommentService.layer
).pipe(Layer.provide(PublicApiInternals));

/**
 * Builds the `/mcp` route with a specific key budget.
 *
 * The budget is a parameter so a test can exhaust it in two calls instead of
 * three hundred, mirroring `makePublicApiRoute`.
 */
export const makePublicApiMcpRoute = (
  budget: PublicApiKeyBudget = PUBLIC_API_KEY_RATE_LIMIT
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const version = yield* Config.String("APP_RELEASE").pipe(
        Config.withDefault("dev")
      );

      return McpServer.toolkit(PublicApiMcpToolkit).pipe(
        Layer.provide(PublicApiMcpHandlers),
        Layer.provide(
          McpServer.layerHttp({
            description:
              "The Feeblo Public API over the Model Context Protocol.",
            instructions: MCP_SERVER_INSTRUCTIONS,
            name: MCP_SERVER_NAME,
            path: PUBLIC_API_MCP_PATH,
            protocols: MCP_PROTOCOLS,
            version,
          })
        ),
        // The tool handlers read the operation's services from the request's
        // fiber context, the same way the HTTP operations do: the route is
        // built with them, and the server runs every request in that graph's
        // full context.
        Layer.provide(PublicApiMcpRepositories),
        Layer.provide(PublicApiInternals)
      );
    })
  ).pipe(
    Layer.provide(makePublicApiMcpKeyMiddleware(budget)),
    // A protocol list this module declares is static; an illegal one (two
    // stateless adapters, for example) is a programming error, not a runtime
    // condition a caller can act on.
    Layer.orDie
  );

/**
 * The route as production composes it.
 *
 * Requires the shared services the server assembles — the database, `Auth`, the
 * rate limiter, the plan decision, `PublicApiConfig`, and media storage — the
 * same set `PublicApiRoute` requires.
 */
export const PublicApiMcpRoute = makePublicApiMcpRoute();
