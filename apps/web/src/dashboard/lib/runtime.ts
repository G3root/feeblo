import {
  createRuntime,
  type RpcClientType,
  withRpc,
} from "@feeblo/rpc-client";
import { Cause, type Effect, Exit } from "effect";
import type { LiveManagedRuntime } from "./runtime/live-layer";
import { useRuntime } from "./runtime/use-runtime";
import { getRuntimePublicEnv } from "./runtime-public-env";

const runtime = createRuntime(getRuntimePublicEnv().apiUrl);
/**
 * Runs an Effect with the default runtime and optional AbortSignal.
 * Resolves with the value on success, throws the cause on failure.
 */
export async function runEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal; runtime?: LiveManagedRuntime }
): Promise<A> {
  const result = await (options?.runtime ?? runtime).runPromiseExit(
    effect as Effect.Effect<A, E, never>,
    { signal: options?.signal }
  );
  if (Exit.isFailure(result)) {
    const cause = result.cause;

    throw new Error(Cause.pretty(cause));
  }
  return result.value;
}

/**
 * Fetches via RPC: runs the given RPC effect with the default runtime.
 * Resolves with the value on success, throws the cause on failure.
 */
export function fetchRpc<A, E, R>(
  cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  return runEffect(withRpc(cb), options);
}

export const useFetchRpc = () => {
  const runtime = useRuntime();
  return <A, E, R>(cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>) => {
    return runEffect(withRpc(cb), { runtime });
  };
};
