import { createRuntime, type RpcClientType, withRpc } from "@feeblo/rpc-client";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import type * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { RpcError } from "./rpc-error";
import { getRuntimePublicEnv } from "./runtime-public-env";

function getServerApiUrl(): string {
  const apiUrl = process.env.API_URL;

  if (!apiUrl) {
    throw new Error("API_URL is not configured on the server");
  }

  return apiUrl;
}

/** Browser- and server-scoped runtimes, created on first use. */
let browserRuntime: ReturnType<typeof createRuntime> | null = null;
let serverRuntime: ReturnType<typeof createRuntime> | null = null;

/**
 * The environment's runtime, resolved lazily.
 *
 * Lazy because both env reads are request- or document-scoped: TanStack Start
 * imports this module into both bundles, and `createRuntime` rejects an
 * undefined API URL, so a module-scope read would throw in one of them.
 *
 * Branched on `hasWindow()` rather than `createIsomorphicFn` because this
 * module is shared with non-Start consumers (browser tests, scripts) and
 * because that wrapper's server branch is what runs outside the Start runtime.
 */
function getRuntime() {
  if (hasWindow()) {
    browserRuntime ??= createRuntime(getRuntimePublicEnv().apiUrl);
    return browserRuntime;
  }

  serverRuntime ??= createRuntime(getServerApiUrl());
  return serverRuntime;
}

/**
 * Runs an Effect with the environment's runtime and optional AbortSignal.
 * Resolves with the value on success, throws a structured RpcError on failure.
 *
 * Isomorphic: collection `queryFn`s run on both sides now, and the browser
 * runtime cannot resolve an API origin on the server.
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
