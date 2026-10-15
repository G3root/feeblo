import { createRuntime, type RpcClientType, withRpc } from "@feeblo/rpc-client";
import { RpcError } from "@feeblo/web-shared/rpc-error";
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
    // SAFETY: The runtime was built with the layers this effect needs;
    // requiring the caller to spell that R out would just repeat the
    // composition root.
    // eslint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- runtime supplies the environment
    effect as Effect.Effect<A, E, never>,
    { signal: options?.signal }
  );
  if (Exit.isFailure(result)) {
    // The same error shape the browser runtime throws: `parseRpcError` reads
    // the tag off the cause, which a `Cause.pretty` string would lose.
    throw new RpcError(result.cause);
  }
  return result.value;
}

export function fetchRpcServer<A, E, R>(
  cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  return runEffect(withRpc(cb), options);
}
