import { createRuntime, type RpcClientType, withRpc } from "@feeblo/rpc-client";
import * as Cause from "effect/Cause";
import type * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { getServerRuntimePublicEnv } from "./server-runtime-public-env";

// Created on first use rather than at module scope: Cloudflare Workers inject
// env per request, so a module-scope `process.env` read (and the runtime built
// from it) would see `undefined`. The API origin is deployment-wide, so the
// lazily-created runtime is cached for the isolate once the first request
// resolves it.
let runtime: ReturnType<typeof createRuntime> | null = null;

function getRuntime() {
  runtime ??= createRuntime(getServerRuntimePublicEnv().apiUrl);
  return runtime;
}

async function runEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  const result = await getRuntime().runPromiseExit(
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
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
