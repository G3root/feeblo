import { FetchHttpClient } from "@effect/platform";
import { Layer, type ManagedRuntime } from "effect";

import { FetchWithCredentials, Rpc } from "../rpc-client";

export const makeLiveLayer = (
  requestInit: RequestInit = { credentials: "include" }
) =>
  Layer.mergeAll(
    Rpc.Default,
    FetchWithCredentials,
    Layer.succeed(FetchHttpClient.RequestInit, requestInit)
  );

export const LiveLayer = makeLiveLayer();

export type LiveManagedRuntime = ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<typeof LiveLayer>,
  never
>;
