import { McpServer } from "effect/ai";
import type { McpSchema } from "effect/ai";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/**
 * The server-side approval gate for the MCP surface's destructive tools.
 *
 * An MCP client already sees `Tool.Destructive` and *may* prompt its user
 * before it sends the call, but that is a client decision: a client that does
 * not implement the annotation, or an agent that drives one, reaches the tool
 * either way. This service is the part the deployment owns. Every operation the
 * registry annotates `destructive` asks before it runs, and the answer comes
 * from a layer composed here or at the application's composition root.
 *
 * Three implementations ship:
 *
 * - `allowAll` is the previous behaviour, and the default, so an existing
 *   client is not broken by the gate's introduction.
 * - `denyAll` refuses every destructive call. That is the shape a read-only
 *   deployment or a review environment wants.
 * - `ask` is the enforced one: it spends MCP's own elicitation request on the
 *   client, and refuses when the client cannot be asked or answers no. This is
 *   what makes the approval server-side rather than advisory.
 *
 * The refusal is a failure of the *tool*, not of the operation: `approval.ts`
 * declares `ApprovalDenied` and `mcp.ts` adds it to the destructive tools'
 * declared failures, so `/api/v1` keeps the published error vocabulary ADR 0004
 * froze and an MCP client reads a declared failure instead of a protocol error.
 */

/** The call a gate is deciding about, as the person answering it should see it. */
export const ApprovalRequest = Schema.Struct({
  /**
   * The input the operation would run with.
   *
   * Already decoded, so the same object the handler receives is the one a
   * client renders; `Schema.Json` because `execute` approval has to survive
   * transport and because a form field can only carry JSON values.
   */
  input: Schema.Json,
  /** The operation's published name, the same string the MCP tool is called by. */
  operation: Schema.String,
});

export type ApprovalRequest = typeof ApprovalRequest.Type;

/**
 * A destructive call the approval channel refused.
 *
 * The tag is deliberately outside `PUBLIC_API_ERROR_CODES`: this failure exists
 * on `/mcp` only, and appending it to the versioned vocabulary would promise it
 * on `/api/v1`, where no surface can produce it.
 */
export class ApprovalDenied extends Schema.TaggedError<ApprovalDenied>()(
  "APPROVAL_DENIED",
  {
    /** Why the call was refused, in the words of the gate that refused it. */
    message: Schema.String,
    /** The operation that was refused. */
    operation: Schema.String,
  }
) {}

/**
 * What a gate is allowed to read from the request.
 *
 * `ask` is the reason: an MCP elicitation is addressed to the connection's
 * client, so the service's own type has to admit the request-scoped services
 * the transport provides to every tool handler. `allowAll` and `denyAll` read
 * nothing, but they share the interface, and the handlers are built once.
 */
export type ApprovalEnvironment =
  | McpSchema.McpRequestContext
  | McpSchema.McpServerClient;

/** The one decision the MCP projection asks for before a destructive call. */
export interface ApprovalService {
  readonly approve: (
    request: ApprovalRequest
  ) => Effect.Effect<void, ApprovalDenied, ApprovalEnvironment>;
}

/** The shape an elicitation form asks for. One field, so a client renders a yes/no. */
const ApprovalAnswer = Schema.Struct({
  approved: Schema.Boolean,
});

const denied = (request: ApprovalRequest, message: string) =>
  new ApprovalDenied({ message, operation: request.operation });

export class Approval extends Context.Service<Approval, ApprovalService>()(
  "PublicApiApproval"
) {
  /** Runs every destructive call, which is the behaviour before the gate existed. */
  static readonly allowAll = Layer.succeed(
    Approval,
    Approval.of({ approve: () => Effect.void })
  );

  /** Refuses every destructive call, for a deployment that may only read. */
  static readonly denyAll = Layer.succeed(
    Approval,
    Approval.of({
      approve: (request) =>
        denied(request, "This deployment refuses destructive MCP calls."),
    })
  );

  /**
   * Asks the connected client's user, and refuses when the question cannot be
   * put to them.
   *
   * The capability check is not politeness: a server-initiated elicitation on a
   * client that never advertised it is a protocol error, and a client that
   * answers `decline` is answering the question. Both become the same typed
   * refusal so the tool's declared failure is the only thing a caller has to
   * handle.
   */
  static readonly ask = Layer.succeed(
    Approval,
    Approval.of({
      approve: (request) =>
        Effect.gen(function* () {
          const capabilities = yield* McpServer.clientCapabilities;
          if (capabilities.elicitation === undefined) {
            return yield* denied(
              request,
              "This MCP client cannot be asked to approve a destructive call."
            );
          }

          const answered = yield* McpServer.elicit({
            message: `Allow "${request.operation}" to change this workspace?`,
            schema: ApprovalAnswer,
          }).pipe(
            Effect.catchTag("ElicitationDeclined", () =>
              Effect.fail(
                denied(
                  request,
                  `The approval request for "${request.operation}" was declined.`
                )
              )
            )
          );

          if (!answered.approved) {
            return yield* denied(
              request,
              `"${request.operation}" was not approved.`
            );
          }
        }),
    })
  );
}

/** The gate a route's layer provides when nothing else was configured. */
export const DEFAULT_APPROVAL_MODE = "allow" as const;

/** The gate modes a deployment may select. */
export const APPROVAL_MODES = ["allow", "deny", "ask"] as const;

export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/**
 * The layer for a configured mode, for a composition root that read one.
 *
 * Kept here rather than in `mcp.ts` so the mapping from a mode name to a layer
 * is one exhaustive switch beside the layers it names.
 */
export const approvalLayer = (mode: ApprovalMode): Layer.Layer<Approval> => {
  switch (mode) {
    case "allow":
      return Approval.allowAll;
    case "deny":
      return Approval.denyAll;
    case "ask":
      return Approval.ask;
  }
};
