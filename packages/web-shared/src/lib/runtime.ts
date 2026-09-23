import { createRuntime, type RpcClientType, withRpc } from "@feeblo/rpc-client";
import type * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { RpcError } from "./rpc-error";
import { getRuntimePublicEnv } from "./runtime-public-env";

// The runtime is created on first use rather than at module scope: TanStack
// Start imports this module into the server bundle too, where the browser-only
// public env is empty (and `createRuntime` rejects an undefined API URL). Every
// caller is client-side, so the lazy read is equivalent on the browser.
let runtime: ReturnType<typeof createRuntime> | null = null;

function getRuntime() {
  runtime ??= createRuntime(getRuntimePublicEnv().apiUrl);
  return runtime;
}

/**
 * Runs an Effect with the default runtime and optional AbortSignal.
 * Resolves with the value on success, throws a structured RpcError on failure.
 */
export async function runEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal; runtime?: ReturnType<typeof createRuntime> }
): Promise<A> {
  const result = await (options?.runtime ?? getRuntime()).runPromiseExit(
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    effect as Effect.Effect<A, E, never>,
    { signal: options?.signal }
  );
  if (Exit.isFailure(result)) {
    throw new RpcError(result.cause);
  }
  return result.value;
}

/**
 * Fetches via RPC: runs the given RPC effect with the default runtime.
 *
 * Handle declared domain failures inside `cb` with `Effect.catchTag` or
 * `Effect.catchTags`; JavaScript promises cannot retain a typed rejection
 * channel. Any failure left unhandled is thrown as `RpcError` for fallback UI.
 */
export function fetchRpc<A, E, R>(
  cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  return runEffect(withRpc(cb), options);
}
