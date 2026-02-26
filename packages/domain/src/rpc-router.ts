import { RpcSerialization, RpcServer } from "@effect/rpc";
import { Layer } from "effect";
import { BoardRpcHandlers } from "./board/handlers";
import { CommentRpcHandlers } from "./comments/handlers";
import { MembershipRpcHandlers } from "./membership/handlers";
import { PostRpcHandlers } from "./post/handlers";
import { AllRpcs } from "./rpc-group";
import { AuthMiddlewareLive } from "./session-middleware";
import { SiteRpcHandlers } from "./site/handlers";

export const RpcRoute = RpcServer.layerHttpRouter({
  group: AllRpcs,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(PostRpcHandlers),
  Layer.provide(BoardRpcHandlers),
  Layer.provide(MembershipRpcHandlers),
  Layer.provide(CommentRpcHandlers),
  Layer.provide(SiteRpcHandlers),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(AuthMiddlewareLive)
);
