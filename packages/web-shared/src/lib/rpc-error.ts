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

/**
 * Safely converts an unknown value thrown by `fetchRpc` into UI-safe copy.
 *
 * Declared RPC failures should be handled in the Effect error channel with
 * `Effect.catchTag` or `Effect.catchTags` before calling `fetchRpc`. This
 * function is only the fallback boundary for an unhandled RPC cause or an
 * unrelated thrown value, so it deliberately does not inspect domain tags or
 * expose internal failure messages.
 */
export function parseRpcError(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): ParsedRpcError {
  if (error instanceof RpcError) {
    return { cause: error.cause, kind: "rpc", message: fallback };
  }

  if (Cause.isCause(error)) {
    return { cause: error, kind: "rpc", message: fallback };
  }

  return { kind: "unexpected", message: fallback };
}
