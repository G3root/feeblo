import { McpServer, Tool, Toolkit } from "effect/ai";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { PublicApiKeyBudget } from "./api-key-auth";
import {
  Approval,
  APPROVAL_MODES,
  approvalLayer,
  DEFAULT_APPROVAL_MODE,
  type ApprovalEnvironment,
  type ApprovalMode,
} from "./approval";
import { makeOperationCatalog, searchCatalog } from "./catalog";
import { MCP_PROTOCOLS, makePublicApiMcpAuthMiddleware } from "./mcp";
import { PUBLIC_API_KEY_RATE_LIMIT, type PublicApiCaller } from "./middleware";
import { PublicApiOperations, type PublicApiDependencies } from "./operations";
import { PublicApiProjections } from "./projections";
import { PublicApiInternals } from "./router";
import {
  Sandbox,
  SandboxError,
  SandboxToolFailure,
  type SandboxToolCall,
} from "./sandbox";

/**
 * Code mode: the Public API as two tools instead of forty.
 *
 * `/mcp` projects every operation to its own tool (ADR 0008), which is the right
 * shape for a client that calls one operation at a time. It is a poor shape for
 * an agent with a task: listing forty tools spends context on schemas the model
 * does not need, and chaining three calls costs three round trips. Code mode is
 * the second projection ADR 0028 records — `search` returns the few tools a task
 * needs *with the TypeScript signature each one has*, and `execute` runs one
 * JavaScript program that calls them, in a sandbox, against the same handlers.
 *
 * Neither tool restates a handler: `execute` looks the operation up in the same
 * registry the HTTP and `/mcp` surfaces project, decodes with the operation's
 * own input schema, enforces the operation's own scope through its own handler,
 * and asks the same `Approval` gate before a destructive call. So a program
 * cannot reach anything the other surfaces do not, and a change to an operation
 * is a change to all three surfaces at once.
 *
 * See `docs/adr/0028-code-mode-is-a-second-mcp-projection.md`.
 */

/** Where the code-mode transport is mounted. */
export const PUBLIC_API_CODE_MODE_MCP_PATH = "/mcp/code";

const MCP_SERVER_NAME = "feeblo-code-mode";

const MCP_SERVER_INSTRUCTIONS =
  "Read and write the calling workspace's Feeblo data by writing one JavaScript program. Call `search` to find operations and their TypeScript signatures, then call `execute` with an async function body that uses `await tools.<name>(input)`. Every call is scoped to the workspace that owns the presented API key, and a destructive call may ask for approval before it runs.";

/** The largest program the tool accepts, before the sandbox's own limits. */
const MAX_PROGRAM_LENGTH = 20_000;

/** The largest query `search` accepts. */
const MAX_QUERY_LENGTH = 500;

const SearchInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(MAX_QUERY_LENGTH)),
  limit: Schema.optional(Schema.Int),
  offset: Schema.optional(Schema.Int),
});

const SearchMatch = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  signature: Schema.String,
  scope: Schema.String,
  readOnly: Schema.Boolean,
  destructive: Schema.Boolean,
  score: Schema.Finite,
});

const SearchResult = Schema.Struct({
  matches: Schema.Array(SearchMatch),
  total: Schema.Int,
  offset: Schema.Int,
  limit: Schema.Int,
});

const ExecuteInput = Schema.Struct({
  code: Schema.String.check(Schema.isMaxLength(MAX_PROGRAM_LENGTH)),
});

const ExecuteResult = Schema.Struct({
  calls: Schema.Array(Schema.String),
  logs: Schema.Array(Schema.String),
  result: Schema.Json,
});

const SearchTool = Tool.make("search", {
  description:
    "Find the operations a program can call. Returns each match's TypeScript signature for the `tools` object inside `execute`. Call this before `execute` unless you already know the exact operation name and its fields.",
  failure: Schema.Never,
  parameters: SearchInput,
  success: SearchResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const ExecuteTool = Tool.make("execute", {
  description:
    "Run one JavaScript program against this workspace. The body is an async function with `tools` in scope: `const page = await tools.listPosts({ limit: 5 }); return page.data.map((post) => post.title);`. `console.log` output comes back in `logs`. A failed call throws, so a program can catch it and continue. No file system, network, process, or timer access.",
  failure: SandboxError,
  parameters: ExecuteInput,
  success: ExecuteResult,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

/** `search` and `execute`, and nothing else: the whole code-mode surface. */
export const PublicApiCodeModeToolkit = Toolkit.make(SearchTool, ExecuteTool);

type CodeModeTools = typeof PublicApiCodeModeToolkit.tools;

/** The failure a program sees when it calls something that cannot work. */
const toolFailure = (message: string) => new SandboxToolFailure({ message });

/** Anything with a published tag and a message, as the operation errors are. */
const TaggedFailure = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String,
});

/** An error with a message but no tag, which a thrown `Error` also satisfies. */
const MessageFailure = Schema.Struct({ message: Schema.String });

/**
 * The message a model reads when a call inside `execute` fails.
 *
 * The tag is kept when there is one — `FORBIDDEN_SCOPE` is a different next
 * step from `NOT_FOUND` — because inside a program the message is the only
 * thing the model can act on: the structured failure the `isError` result
 * carries on `/mcp` has no equivalent for a caught exception.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The parameter is the point: it accepts any operation failure without spelling `unknown` (which the anti-slop rules ban) or a union narrow enough to exclude one the registry can throw.
const failureMessage = <Failure>(error: Failure): string => {
  if (Schema.is(TaggedFailure)(error)) {
    return `${error._tag}: ${error.message}`;
  }
  if (Schema.is(MessageFailure)(error)) return error.message;
  return "The call failed.";
};

/**
 * The erased view of one operation's handler.
 *
 * `PublicApiOperations` holds operations of many shapes (ADR 0007), and a
 * lookup by name produces `unknown` for both the input and the failure. The
 * input is decoded with the operation's own schema before it is passed here;
 * the failure is narrowed back to a message by `failureMessage`. The alias is
 * where those two erasures are named, so the call site below is one assertion.
 */
type ErasedOperationHandler = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- See the alias's comment: this is the erased boundary the registry's lookup produces.
  input: unknown
) => // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- See the alias's comment: the operation's failure type is erased at this boundary by design (ADR 0007).
Effect.Effect<unknown, unknown, PublicApiDependencies | PublicApiCaller>;

const buildPublicApiCodeModeHandlers = () =>
  Effect.gen(function* () {
    const context = yield* Effect.context<PublicApiDependencies>();
    const approval = yield* Approval;
    const sandbox = yield* Sandbox;

    // Built once, when the toolkit's layer is, so a request pays only for the
    // page it reads.
    const catalog = makeOperationCatalog();
    const operations = new Map<string, (typeof PublicApiOperations)[number]>(
      PublicApiOperations.map((operation) => [operation.name, operation])
    );

    const search = (input: typeof SearchInput.Type) =>
      Effect.succeed(
        searchCatalog(catalog, input.query, {
          limit: input.limit ?? undefined,
          offset: input.offset ?? undefined,
        })
      );

    const invoke = Effect.fn("CodeMode.invoke")(function* (
      call: SandboxToolCall
    ) {
      const operation = operations.get(call.name);
      if (operation === undefined) {
        return yield* toolFailure(
          `Unknown tool "${call.name}". Call search first and use one of the names it returns.`
        );
      }

      const input = yield* Schema.decodeUnknownEffect(operation.input)(
        call.input
      ).pipe(
        Effect.mapError(() =>
          toolFailure(
            `The input passed to "${call.name}" does not match its signature. Call search again for its fields.`
          )
        )
      );

      // The same gate `/mcp` uses, on the same annotation: a program is not a
      // way around a deployment that refuses destructive calls.
      if (operation.annotations.destructive) {
        yield* approval
          .approve({ input: call.input, operation: operation.name })
          .pipe(Effect.mapError((failure) => toolFailure(failure.message)));
      }

      // SAFETY: the erased view is the operation's own handler, and the value
      // passed was decoded with the operation's own schema above, so it accepts
      // exactly what the decode produced.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, effecttsgo/any-unknown-in-error-context -- See the SAFETY comment: the assertion only names the erased shape the registry already has, and `failureMessage` narrows the erased failure to a string immediately after.
      const value = yield* (operation.handler as ErasedOperationHandler)(
        input
      ).pipe(
        Effect.provideContext(context),
        Effect.mapError((error) => toolFailure(failureMessage(error)))
      );

      // Encoded with the operation's own output schema, so what the program
      // sees is the JSON form the HTTP surface publishes rather than a decoded
      // class instance `JSON.stringify` would flatten differently.
      const encoded = yield* Schema.encodeUnknownEffect(
        Schema.toCodecJson(operation.output)
      )(value).pipe(
        Effect.mapError(() =>
          toolFailure(`The result of "${call.name}" could not be encoded.`)
        )
      );

      // Validated rather than asserted: the codec's encoded form is the
      // published JSON DTO (ADR 0004), and a decode that fails is a bug in the
      // operation's schema rather than something the program can cause.
      return yield* Schema.decodeEffect(Schema.Json)(encoded).pipe(
        Effect.mapError(() =>
          toolFailure(`The result of "${call.name}" is not JSON.`)
        )
      );
    });

    const execute = Effect.fn("CodeMode.execute")(function* (
      input: typeof ExecuteInput.Type
    ) {
      // The sandbox hands a program's tool call back from its own scoped
      // context, so the request-scoped services the call needs — the key
      // middleware's caller and, for the approval gate, the MCP client — are
      // captured here and supplied to each call rather than inherited.
      const request = yield* Effect.context<
        PublicApiCaller | ApprovalEnvironment
      >();

      const outcome = yield* sandbox.run({
        call: (call) => invoke(call).pipe(Effect.provideContext(request)),
        code: input.code,
      });

      return {
        calls: outcome.calls,
        logs: outcome.logs,
        result: outcome.result,
      };
    });

    const handlers = { execute, search };

    // SAFETY: `PublicApiCodeModeToolkit` is built from exactly these two
    // tools, so the record is the toolkit's handler map; the cast is what
    // converts a record of two named functions into the mapped type the
    // toolkit declares for them.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- See the SAFETY comment: the record is keyed by the toolkit's own tool names.
    return handlers as unknown as Toolkit.HandlersFrom<CodeModeTools>;
  });

const PublicApiCodeModeHandlers = PublicApiCodeModeToolkit.toLayer(
  buildPublicApiCodeModeHandlers()
);

/**
 * The public repositories the operations read, composed the same way `/mcp`
 * composes them.
 *
 * A second instance of the bundle rather than a shared constant: `mcp.ts` does
 * not export its composed layer, and the one thing both routes must agree on is
 * `PublicApiProjections`, which is the single declaration they read from.
 */
const CodeModeRepositories = PublicApiProjections.pipe(
  Layer.provide(PublicApiInternals)
);

/**
 * Builds the `/mcp/code` route.
 *
 * The approval gate is read from `MCP_APPROVAL` exactly as `/mcp` reads it, so
 * an operator configures one decision for both surfaces. `Sandbox` is left in
 * the layer's requirements: the application composes the executor, the surface
 * only declares that it needs one.
 */
export const makePublicApiCodeModeRoute = (
  budget: PublicApiKeyBudget = PUBLIC_API_KEY_RATE_LIMIT,
  configuredApproval?: ApprovalMode
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const version = yield* Config.String("APP_RELEASE").pipe(
        Config.withDefault("dev")
      );
      const approvalMode =
        configuredApproval ??
        (yield* Config.Literals(APPROVAL_MODES, "MCP_APPROVAL").pipe(
          Config.withDefault(DEFAULT_APPROVAL_MODE)
        ));

      return McpServer.toolkit(PublicApiCodeModeToolkit).pipe(
        Layer.provide(PublicApiCodeModeHandlers),
        Layer.provide(approvalLayer(approvalMode)),
        Layer.provide(
          McpServer.layerHttp({
            description:
              "The Feeblo Public API as one searchable set of tools a program can call.",
            instructions: MCP_SERVER_INSTRUCTIONS,
            name: MCP_SERVER_NAME,
            path: PUBLIC_API_CODE_MODE_MCP_PATH,
            protocols: MCP_PROTOCOLS,
            version,
          })
        ),
        Layer.provide(CodeModeRepositories),
        Layer.provide(PublicApiInternals)
      );
    })
  ).pipe(
    Layer.provide(makePublicApiMcpAuthMiddleware(budget)),
    // A static protocol list; an illegal one is a programming error.
    Layer.orDie
  );

/** The route as production composes it. */
export const PublicApiCodeModeRoute = makePublicApiCodeModeRoute();
