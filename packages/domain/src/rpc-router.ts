import { RpcSerialization, RpcServer } from "@effect/rpc";
import { Layer } from "effect";
import { PostRpcHandlers } from "./post/handlers";
import { PostRpcs } from "./post/rpcs";
import { AuthMiddlewareLive } from "./session-middleware";
import { UserRpcHandlers } from "./user/handlers";
import { UserRpcs } from "./user/rpcs";

export const AllRpcs = PostRpcs.merge(UserRpcs);

export const RpcRoute = RpcServer.layerHttpRouter({
  group: AllRpcs,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(UserRpcHandlers),
  Layer.provide(PostRpcHandlers),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(AuthMiddlewareLive)
);
