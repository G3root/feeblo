import { AllRpcs } from "@feeblo/domain/rpc-group";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as RpcClient from "effect/rpc/RpcClient";
import type * as RpcClientError from "effect/rpc/RpcClientError";
import * as RpcSerialization from "effect/rpc/RpcSerialization";

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

export const createRpcProtocolLive = (apiUrl: string) =>
  RpcClient.layerProtocolHttp({
    url: `${normalizeApiUrl(apiUrl)}/rpc`,
  }).pipe(Layer.provide([FetchWithCredentials, RpcSerialization.layerNdjson]));

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
