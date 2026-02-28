import {
  Rpc,
  type RuntimeRequirements,
  runtime,
  withRpc,
} from "@feeblo/rpc-client";
import { type Effect, Exit } from "effect";
import type { LiveManagedRuntime } from "./runtime/live-layer";
import { useRuntime } from "./runtime/use-runtime";

/**
 * Runs an Effect with the default runtime and optional AbortSignal.
 * Resolves with the value on success, throws the cause on failure.
 */
export async function runEffect<A, E, R extends RuntimeRequirements>(
  effect: Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal; runtime?: LiveManagedRuntime }
): Promise<A> {
  const result = await (options?.runtime ?? runtime).runPromiseExit(effect, {
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

export const useFetchRpc = () => {
  const runtime = useRuntime();
  return <A, E>(cb: (rpc: Rpc) => Effect.Effect<A, E>) => {
    return runEffect(withRpc(cb), { runtime });
  };
};

export const useRpcClient = () => runtime.runSync(Rpc);
