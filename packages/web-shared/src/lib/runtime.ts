import { createRuntime, type RpcClientType, withRpc } from "@feeblo/rpc-client";
import type * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { RpcError } from "./rpc-error";
import { getRuntimePublicEnv } from "./runtime-public-env";

const runtime = createRuntime(getRuntimePublicEnv().apiUrl);

/**
 * Runs an Effect with the default runtime and optional AbortSignal.
 * Resolves with the value on success, throws a structured RpcError on failure.
 */
export async function runEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal; runtime?: typeof runtime }
): Promise<A> {
  const result = await (options?.runtime ?? runtime).runPromiseExit(
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
