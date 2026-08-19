import * as Cause from "effect/Cause";
import * as Option from "effect/Option";

export type ParsedRpcError =
  | {
      readonly cause: Cause.Cause<unknown>;
      readonly kind: "rpc";
      readonly message: string;
    }
  | {
      readonly kind: "unexpected";
      readonly message: string;
    };

export class RpcError extends Error {
  override readonly cause: Cause.Cause<unknown>;

  constructor(cause: Cause.Cause<unknown>) {
    super("RPC request failed", { cause });
    this.name = "RpcError";
    this.cause = cause;
  }
}

function extractUserMessage(failure: unknown): string | undefined {
  if (!failure || typeof failure !== "object") {
    return undefined;
  }
  const record = failure as Record<string, unknown>;
  // Never expose internal server / DB errors directly
  if (
    record["_tag"] === "InternalServerError" ||
    record["_tag"] === "SqlError" ||
    record["_tag"] === "SchemaError" ||
    record["_tag"] === "LegidError"
  ) {
    return undefined;
  }
  if (typeof record["reason"] === "string" && record["reason"].trim()) {
    return record["reason"] as string;
  }
  if (typeof record["message"] === "string" && record["message"].trim()) {
    return record["message"] as string;
  }
  return undefined;
}

function getCauseMessage(cause: Cause.Cause<unknown>): string | undefined {
  // Effect's canonical API: extract the first typed failure, if any.
  // For RpcError the cause is a Cause<E> where E is a tagged domain error
  // like PolicyDeniedError ({ _tag: "PolicyDenied", reason: string }).
  const failureOption = Cause.findErrorOption(cause);
  if (Option.isSome(failureOption)) {
    const msg = extractUserMessage(failureOption.value);
    if (msg) {
      return msg;
    }
  }
  // Fallback for causes that wrap the error differently (e.g. nested
  // Fail reasons or parallel causes): scan the Cause's reasons.
  // `cause.reasons` is available on the Cause value when it exists.
  const maybeReasons = (cause as unknown as { reasons?: ReadonlyArray<unknown> }).reasons;
  if (Array.isArray(maybeReasons)) {
    for (const reason of maybeReasons) {
      // Fail reason shape: { _tag: "Fail", error: E }
      const error = (reason as { error?: unknown }).error ?? reason;
      const msg = extractUserMessage(error);
      if (msg) {
        return msg;
      }
    }
  }
  return undefined;
}

/**
 * Safely converts an unknown value thrown by `fetchRpc` into UI-safe copy.
 *
 * Extracts a user-facing `reason` / `message` from known domain failures
 * (e.g. `PolicyDeniedError`, `BadRequestError`) and falls back to the
 * provided safe default for unexpected or internal errors.
 *
 * Declared RPC failures that are handled explicitly should still be caught
 * in the Effect error channel with `Effect.catchTag` before calling
 * `fetchRpc`.
 */
export function parseRpcError<T>(
  error: T,
  fallback = "Something went wrong. Please try again."
): ParsedRpcError {
  if (error instanceof RpcError) {
    const message = getCauseMessage(error.cause) ?? fallback;
    return { cause: error.cause, kind: "rpc", message };
  }

  if (Cause.isCause(error)) {
    const message = getCauseMessage(error) ?? fallback;
    return { cause: error, kind: "rpc", message };
  }

  return { kind: "unexpected", message: fallback };
}
