import { VITE_API_URL } from "astro:env/client";
import { FetchHttpClient } from "@effect/platform";
import { RpcClient, RpcSerialization } from "@effect/rpc";
import { AllRpcs } from "@feeblo/domain/rpc-group";
import { Effect, Layer } from "effect";

/** Fetch client that sends cookies (needed for BetterAuth session) */
export const FetchWithCredentials = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })
  )
);

const RpcProtocolLive = RpcClient.layerProtocolHttp({
  url: `${VITE_API_URL}/rpc`,
}).pipe(Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]));

export type RpcClientType = RpcClient.FromGroup<typeof AllRpcs>;

export class Rpc extends Effect.Service<Rpc>()("Rpc", {
  scoped: RpcClient.make(AllRpcs),
  dependencies: [RpcProtocolLive],
}) {}

export const withRpc = <A, E, R>(cb: (rpc: Rpc) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(Rpc, cb);
