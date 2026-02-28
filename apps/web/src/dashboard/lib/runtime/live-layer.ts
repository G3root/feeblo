import { FetchHttpClient } from "@effect/platform";
import { FetchWithCredentials, RpcLive } from "@feeblo/rpc-client";
import { Layer, type ManagedRuntime } from "effect";

export const makeLiveLayer = (
  requestInit: RequestInit = { credentials: "include" }
) =>
  Layer.mergeAll(
    RpcLive,
    FetchWithCredentials,
    Layer.succeed(FetchHttpClient.RequestInit, requestInit)
  );

export const LiveLayer = makeLiveLayer();

export type LiveManagedRuntime = ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<typeof LiveLayer>,
  never
>;
