import { RpcSerialization, RpcServer } from "@effect/rpc";
import { Layer } from "effect";
import { UserRpcHandlers } from "./user/handlers";
import { UserRpcs } from "./user/rpcs";

export const RpcRoute = RpcServer.layerHttpRouter({
  group: UserRpcs,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(UserRpcHandlers),
  Layer.provide(RpcSerialization.layerNdjson)
);
