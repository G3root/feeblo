import {
  createRuntime,
  type RpcClientType,
  withRpc,
} from "@feeblo/rpc-client";
import { Cause, type Effect, Exit } from "effect";
import type { LiveManagedRuntime } from "./runtime/live-layer";

import { getServerRuntimePublicEnv } from "./server-runtime-public-env";

const runtime = createRuntime(getServerRuntimePublicEnv().apiUrl);

async function runEffect<A, E, R>(
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

export function fetchRpcServer<A, E, R>(
  cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  return runEffect(withRpc(cb), options);
}
