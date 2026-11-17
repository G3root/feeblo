import { AllRpcs } from "@feeblo/domain/rpc-group";
import { isReadRpc } from "@feeblo/domain/rpc-kind";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as RpcClient from "effect/rpc/RpcClient";
import type * as RpcClientError from "effect/rpc/RpcClientError";
import * as RpcSchema from "effect/rpc/RpcSchema";
import * as RpcSerialization from "effect/rpc/RpcSerialization";

import { layerProtocolHttpBatch } from "./batch-protocol";

/** Fetch client that sends cookies (needed for BetterAuth session) */
export const FetchWithCredentials = FetchHttpClient.layer.pipe(
  Layer.provide(
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    Layer.succeed(FetchHttpClient.RequestInit, {
      credentials: "include",
    } as RequestInit)
  )
);

function normalizeApiUrl(apiUrl: string) {
  return apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
}

/**
 * Whether a tag's frames may share one HTTP request: a read may, unless it
 * streams.
 *
 * A stream is sent alone on purpose. Upstream runs a batch in the client's scope
 * and forwards only `Request` frames, so interrupting a batched stream neither
 * ends the batch nor cancels its HTTP request — the response keeps pumping until
 * the client shuts down. Disposing an atom or leaving a route would leak a
 * connection, and the data-transfer page opens a new watch per filter. Sent
 * through the unbatched protocol, from the caller's own fiber, interruption
 * aborts the request.
 */
export const sharesRpcBatch = (tag: string): boolean => {
  if (!isReadRpc(tag)) return false;
  const rpc = AllRpcs.requests.get(tag);

  return rpc !== undefined && !RpcSchema.isStreamSchema(rpc.successSchema);
};

/**
 * One memo map for every RPC protocol layer this module builds.
 *
 * Effect's memo map shares a layer instance across builds and keeps it alive
 * until the last scope observing it closes. The promise runtime and an
 * `AtomRpc` runtime build different thin clients over the same protocol layer,
 * so with a shared memo map they also share one protocol — one HTTP client and,
 * when the browser batches frames, one batch queue.
 */
export const rpcRuntimeMemoMap: Layer.MemoMap = Layer.makeMemoMapUnsafe();

const protocolLayers = new Map<string, Layer.Layer<RpcClient.Protocol>>();

/**
 * The HTTP protocol layer for one API URL, memoized per normalized URL.
 *
 * `Layer` memoizes by identity, so two `createRpcProtocolLive` calls would build
 * two protocols even under one memo map. Every runtime that talks to the same
 * API resolves this one layer instead.
 */
export const rpcProtocolFor = (
  apiUrl: string
): Layer.Layer<RpcClient.Protocol> => {
  const normalized = normalizeApiUrl(apiUrl);
  const existing = protocolLayers.get(normalized);

  if (existing !== undefined) {
    return existing;
  }

  const protocol = createRpcProtocolLive(normalized);
  protocolLayers.set(normalized, protocol);

  return protocol;
};

export const createRpcProtocolLive = (apiUrl: string) => {
  const url = `${normalizeApiUrl(apiUrl)}/rpc`;

  // A batch carries one set of request headers, so only a runtime that belongs
  // to one request may batch. The server's runtime is a module-level singleton
  // shared by every concurrent request; batching there would let one request's
  // cookie authenticate another's frames.
  const protocol = hasWindow()
    ? layerProtocolHttpBatch({ url, sharesBatch: sharesRpcBatch })
    : RpcClient.layerProtocolHttp({ url });

  return protocol.pipe(
    Layer.provide([FetchWithCredentials, RpcSerialization.layerNdjson])
  );
};

export type RpcClientType = RpcClient.FromGroup<
  typeof AllRpcs,
  RpcClientError.RpcClientError
>;

export class Rpc extends Context.Service<Rpc, RpcClientType>()("Rpc", {
  make: RpcClient.make(AllRpcs),
}) {}

export const createRpcLive = (apiUrl: string) =>
  Layer.effect(Rpc, Rpc.make).pipe(Layer.provide(rpcProtocolFor(apiUrl)));

export const withRpc = <A, E, R>(
  cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>
) => Effect.flatMap(Rpc, cb);

export const createRuntimeLayer = (apiUrl: string) =>
  Layer.mergeAll(createRpcLive(apiUrl), FetchWithCredentials);

export const createRuntime = (apiUrl: string) =>
  ManagedRuntime.make(createRuntimeLayer(apiUrl), {
    memoMap: rpcRuntimeMemoMap,
  });
