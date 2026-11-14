import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The bounded executor the code-mode `execute` tool runs a model's program in.
 *
 * A port, not an implementation: the subprocess this ships with is Node's, and
 * the tool that needs it (`code-mode.ts`) should not know that. The service is
 * what the code-mode route's layer requires, so an application can substitute a
 * Worker, a container, or the test double a unit test wants without changing a
 * line of the surface.
 *
 * The contract is deliberately small. A program is a string of JavaScript whose
 * body runs in an `async` function with a `tools` object in scope; every call it
 * makes is handed back here through `call`, and only a JSON result, the logs the
 * program wrote, and the names it called come out. Nothing about the host's
 * context is visible to the program, and the program cannot make a tool call
 * that the implementation did not route through `call`.
 */

/** What an implementation enforces, overridable per run by the caller. */
export interface SandboxLimits {
  /**
   * The program's own execution: real elapsed time less the time a call spends
   * waiting on a person.
   */
  readonly wallClockMs: number;
  /**
   * The most time one run may spend waiting on a person.
   *
   * An approval wait is not charged to `wallClockMs` — a human is not the
   * program — but the child keeps executing and the run keeps its concurrency
   * permit while the answer is pending, so the excluded wait is bounded too.
   */
  readonly maxApprovalWaitMs: number;
  /** One synchronous evaluation, which is what a runaway loop trips. */
  readonly evaluationMs: number;
  /** The most tool calls one program may make. */
  readonly maxCalls: number;
  /** The most log lines the result carries. */
  readonly maxLogs: number;
  /** The most characters the encoded result may hold. */
  readonly maxResultChars: number;
  /**
   * The resident memory the child may reach before it stops itself.
   *
   * Enforced by the child, not the OS: Node exposes no portable per-child
   * limit, so this is the tight bound the sandbox can apply by itself. The
   * deployment's container memory limit is the hard, OS-level backstop.
   */
  readonly maxRssBytes: number;
}

/**
 * The production budget.
 *
 * A deliberate fraction of a request's patience: an MCP client that waits ten
 * seconds for a program can retry, and a program that needs longer than this to
 * answer a question about a workspace is a program that should call `search`
 * and ask again.
 */
export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  evaluationMs: 1_000,
  maxApprovalWaitMs: 5 * 60_000,
  maxCalls: 100,
  maxLogs: 200,
  maxResultChars: 100_000,
  maxRssBytes: 256 * 1024 * 1024,
  wallClockMs: 10_000,
};

/** How a sandbox run failed, for a caller that has to describe it. */
export const SANDBOX_FAILURE_CODES = [
  /** The program outlived a limit, or made more calls than it was allowed. */
  "LIMIT_EXCEEDED",
  /** The program threw, or the worker died before it answered. */
  "CRASHED",
  /** The program's value could not be represented as JSON. */
  "UNREPRESENTABLE_RESULT",
] as const;

export type SandboxFailureCode = (typeof SANDBOX_FAILURE_CODES)[number];

/**
 * A failed sandbox run.
 *
 * The message is the program's own error message when it has one, because that
 * is what a model can act on: "Cannot read properties of undefined" is a
 * different next step from "the program exceeded its tool-call budget".
 */
export class SandboxError extends Schema.TaggedError<SandboxError>()(
  "SANDBOX_ERROR",
  {
    code: Schema.Literals(SANDBOX_FAILURE_CODES),
    message: Schema.String,
  }
) {}

/** One `tools.<name>(input)` call a program made. */
export const SandboxToolCall = Schema.Struct({
  /** The operation's published name, which is also the tool name. */
  name: Schema.String,
  /** The decoded JSON value the program passed. */
  input: Schema.Json,
});

export type SandboxToolCall = typeof SandboxToolCall.Type;

/**
 * A tool call the sandboxed program is allowed to observe as a thrown error.
 *
 * A refusal — an unknown tool, a schema the input fails, a scope the key does
 * not hold, an approval the gate denied — is data inside the program, not a
 * sandbox failure: the program can catch it, try another call, and still return
 * an answer. That is what makes one program worth several tool calls.
 */
export class SandboxToolFailure extends Schema.TaggedError<SandboxToolFailure>()(
  "SANDBOX_TOOL_FAILURE",
  { message: Schema.String }
) {}

/**
 * What a tool call may ask of the run it belongs to.
 *
 * `waitForPerson` is the approval exception: an MCP elicitation waits for a
 * human, and that wait must not be charged to the program's execution budget.
 * The sandbox excludes the effect's real duration from the wall clock, up to
 * the run's `maxApprovalWaitMs`; nothing else about the run changes.
 */
export interface SandboxCallControls {
  readonly waitForPerson: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
}

/** What a caller supplies for one run. */
export interface SandboxProgram {
  /** JavaScript to evaluate as the body of an `async` function. */
  readonly code: string;
  /** Per-run overrides; anything unset comes from the implementation's limits. */
  readonly limits?: Partial<SandboxLimits> | undefined;
  /**
   * The host side of `tools.<name>(input)`.
   *
   * Erased to string-and-JSON at this boundary on purpose: the program is
   * untyped text, so the operation lookup, the input decode, and the approval
   * decision all happen behind this function, in the caller's own types.
   */
  readonly call: (
    call: SandboxToolCall,
    controls: SandboxCallControls
  ) => Effect.Effect<Schema.Json, SandboxToolFailure>;
}

/** What a successful run produced. */
export interface SandboxOutcome {
  /** The tool names the program called, in order, for a caller's audit trail. */
  readonly calls: readonly string[];
  /** The `console` output the program produced, capped by the limits. */
  readonly logs: readonly string[];
  /** The program's return value, encoded as JSON. */
  readonly result: Schema.Json;
}

export interface SandboxService {
  readonly run: (
    program: SandboxProgram
  ) => Effect.Effect<SandboxOutcome, SandboxError>;
}

export class Sandbox extends Context.Service<Sandbox, SandboxService>()(
  "Sandbox"
) {}
