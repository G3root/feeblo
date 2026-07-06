/** biome-ignore-all lint/suspicious/noExplicitAny: <explanation> */
import { AllRpcs } from "@feeblo/domain/rpc-group";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type * as RpcClientError from "effect/unstable/rpc/RpcClientError";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";

/** Fetch client that sends cookies (needed for BetterAuth session) */
export const FetchWithCredentials = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, {
      credentials: "include",
    } as RequestInit)
  )
);

function normalizeApiUrl(apiUrl: string) {
  return apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
}

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
  Layer.effect(Rpc, Rpc.make).pipe(
    Layer.provide(createRpcProtocolLive(apiUrl))
  );

export const withRpc = <A, E, R>(
  cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>
) => Effect.flatMap(Rpc, cb);

export const createRuntimeLayer = (apiUrl: string) =>
  Layer.mergeAll(createRpcLive(apiUrl), FetchWithCredentials);

export const createRuntime = (apiUrl: string) =>
  ManagedRuntime.make(createRuntimeLayer(apiUrl));
