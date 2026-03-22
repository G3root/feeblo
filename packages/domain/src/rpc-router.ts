import { RpcSerialization, RpcServer } from "@effect/rpc";
import { Layer } from "effect";
import { BillingRpcHandlers } from "./billing/handlers";
import { BoardRpcHandlers } from "./board/handlers";
import { ChangelogRpcHandlers } from "./changelog/handlers";
import { CommentReactionRpcHandlers } from "./comment-reaction/handlers";
import { CommentRpcHandlers } from "./comments/handlers";
import { MembershipRpcHandlers } from "./membership/handlers";
import { PostRpcHandlers } from "./post/handlers";
import { PostReactionRpcHandlers } from "./post-reaction/handlers";
import { AllRpcs } from "./rpc-group";
import {
  AuthMiddlewareLive,
  OptionalAuthMiddlewareLive,
} from "./session-middleware";
import { SiteRpcHandlers } from "./site/handlers";
import { UpvoteRpcHandlers } from "./upvote/handlers";
import { WorkspaceRpcHandlers } from "./workspace/handlers";

export const RpcRoute = RpcServer.layerHttpRouter({
  group: AllRpcs,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(PostRpcHandlers),
  Layer.provide(BillingRpcHandlers),
  Layer.provide(BoardRpcHandlers),
  Layer.provide(ChangelogRpcHandlers),
  Layer.provide(MembershipRpcHandlers),
  Layer.provide(CommentReactionRpcHandlers),
  Layer.provide(CommentRpcHandlers),
  Layer.provide(SiteRpcHandlers),
  Layer.provide(UpvoteRpcHandlers),
  Layer.provide(PostReactionRpcHandlers),
  Layer.provide(WorkspaceRpcHandlers),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(OptionalAuthMiddlewareLive)
);
