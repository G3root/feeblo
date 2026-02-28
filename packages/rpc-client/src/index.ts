/** biome-ignore-all lint/suspicious/noExplicitAny: <explanation> */
import { VITE_API_URL } from "astro:env/client";
import { FetchHttpClient } from "@effect/platform";
import { RpcClient, RpcSerialization } from "@effect/rpc";
import { AllRpcs } from "@feeblo/domain/rpc-group";
import { type Context, Effect, Layer, ManagedRuntime } from "effect";

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
export type Rpc = RpcClientType;

type RpcTag = Context.Tag<Rpc, Rpc> & {
  readonly Default: Layer.Layer<Rpc, never, never>;
};

const RpcInternal = Effect.Service<any>()("Rpc", {
  scoped: RpcClient.make(AllRpcs),
  dependencies: [RpcProtocolLive],
});

export const Rpc: RpcTag = RpcInternal as RpcTag;
export const RpcLive = Rpc.Default;

export const withRpc = <A, E, R>(cb: (rpc: Rpc) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(Rpc, cb);

export const runtimeLayer = Layer.mergeAll(RpcLive, FetchWithCredentials);

export const runtime = ManagedRuntime.make(runtimeLayer);

/** Services provided by the default runtime (used for runEffect typing). */
export type RuntimeRequirements = ManagedRuntime.ManagedRuntime.Context<
  typeof runtime
>;
