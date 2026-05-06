/** biome-ignore-all lint/suspicious/noExplicitAny: <explanation> */
import { VITE_API_URL } from "astro:env/client";
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

const RpcProtocolLive = RpcClient.layerProtocolHttp({
  url: `${VITE_API_URL}/rpc`,
}).pipe(Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]));

export type RpcClientType = RpcClient.FromGroup<
  typeof AllRpcs,
  RpcClientError.RpcClientError
>;

export class Rpc extends Context.Service<Rpc, RpcClientType>()("Rpc", {
  make: RpcClient.make(AllRpcs),
}) {}

export const RpcLive = Layer.effect(Rpc, Rpc.make).pipe(
  Layer.provide(RpcProtocolLive)
);

export const withRpc = <A, E, R>(
  cb: (rpc: RpcClientType) => Effect.Effect<A, E, R>
) => Effect.flatMap(Rpc.asEffect(), cb);

export const runtimeLayer = Layer.mergeAll(RpcLive, FetchWithCredentials);

export const runtime = ManagedRuntime.make(runtimeLayer);

/** Services provided by the default runtime (used for runEffect typing). */
export type RuntimeRequirements = ManagedRuntime.ManagedRuntime.Services<
  typeof runtime
>;
