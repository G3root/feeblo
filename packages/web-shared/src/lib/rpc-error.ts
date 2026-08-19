import * as Cause from "effect/Cause";

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

function findMessageInCause(
  value: unknown,
  seen = new WeakSet<object>()
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    return undefined;
  }
  seen.add(obj);
  const record = value as Record<string, unknown>;
  const direct = extractUserMessage(record);
  if (direct) {
    return direct;
  }
  // Common Cause nesting keys
  const keys = [
    "error",
    "failure",
    "cause",
    "defect",
    "reason",
    "left",
    "right",
    "head",
    "tail",
    "value",
    "_cause",
    "failures",
    "reasons",
    "defects",
  ];
  for (const key of keys) {
    const child = record[key];
    if (child && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = findMessageInCause(item, seen);
          if (found) {
            return found;
          }
        }
      } else {
        const found = findMessageInCause(child, seen);
        if (found) {
          return found;
        }
      }
    }
  }
  // Fallback: scan all object values (covers unknown Cause shapes)
  for (const v of Object.values(record)) {
    if (v && typeof v === "object") {
      const found = findMessageInCause(v as object, seen);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function getCauseMessage(cause: Cause.Cause<unknown>): string | undefined {
  return findMessageInCause(cause as unknown);
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
