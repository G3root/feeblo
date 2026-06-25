import { createRpcLive, FetchWithCredentials } from "@feeblo/rpc-client";
import { Layer, type ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { getRuntimePublicEnv } from "../runtime-public-env";

export const makeLiveLayer = (
  requestInit: RequestInit = { credentials: "include" }
) =>
  Layer.mergeAll(
    createRpcLive(getRuntimePublicEnv().apiUrl),
    FetchWithCredentials,
    Layer.succeed(FetchHttpClient.RequestInit, requestInit)
  );

export const LiveLayer = makeLiveLayer();

export type LiveManagedRuntime = ManagedRuntime.ManagedRuntime<
  Layer.Success<typeof LiveLayer>,
  never
>;
