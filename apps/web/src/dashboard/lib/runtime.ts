import { type Effect, Exit, Layer, ManagedRuntime } from "effect";

import { FetchWithCredentials, Rpc, withRpc } from "./rpc-client";

export const runtimeLayer = Layer.mergeAll(
  Rpc.Default,

  FetchWithCredentials
);

export const runtime = ManagedRuntime.make(runtimeLayer);

/** Services provided by the default runtime (used for runEffect typing). */
export type RuntimeRequirements = ManagedRuntime.ManagedRuntime.Context<
  typeof runtime
>;

/**
 * Runs an Effect with the default runtime and optional AbortSignal.
 * Resolves with the value on success, throws the cause on failure.
 */
export async function runEffect<A, E, R extends RuntimeRequirements>(
  effect: Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  const result = await runtime.runPromiseExit(effect, {
    signal: options?.signal,
  });
  if (Exit.isFailure(result)) {
    throw result.cause;
  }
  return result.value;
}

/**
 * Fetches via RPC: runs the given RPC effect with the default runtime.
 * Resolves with the value on success, throws the cause on failure.
 */
export function fetchRpc<A, E>(
  cb: (rpc: Rpc) => Effect.Effect<A, E>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  return runEffect(withRpc(cb), options);
}

export const useRpcClient = () => runtime.runSync(Rpc);
