/** biome-ignore-all lint/suspicious/noExplicitAny: <explanation> */
import { AllRpcs } from "@feeblo/domain/rpc-group";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  RpcClient,
  type RpcClientError,
  RpcSerialization,
} from "effect/unstable/rpc";

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
  Layer.effect(Rpc, Rpc.make).pipe(Layer.provide(createRpcProtocolLive(apiUrl)));

export const withRpc = <A, E, R>(
  cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>
) => Effect.flatMap(Rpc, cb);

export const createRuntimeLayer = (apiUrl: string) =>
  Layer.mergeAll(createRpcLive(apiUrl), FetchWithCredentials);

export const createRuntime = (apiUrl: string) =>
  ManagedRuntime.make(createRuntimeLayer(apiUrl));
