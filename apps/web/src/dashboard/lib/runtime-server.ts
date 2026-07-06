import { createRuntime, type RpcClientType, withRpc } from "@feeblo/rpc-client";
import * as Cause from "effect/Cause";
import type * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { getServerRuntimePublicEnv } from "./server-runtime-public-env";

const runtime = createRuntime(getServerRuntimePublicEnv().apiUrl);

async function runEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  const result = await runtime.runPromiseExit(
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
