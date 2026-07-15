import * as Layer from "effect/Layer";

import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

import { BillingRpcHandlers } from "./billing/handlers";
import { BoardRpcHandlers } from "./board/handlers";
import { ChangelogRpcHandlers } from "./changelog/handlers";
import { CommentReactionRpcHandlers } from "./comment-reaction/handlers";
import { CommentRpcHandlers } from "./comments/handlers";
import { CompanyRpcHandlers } from "./company/handlers";
import { ContactRpcHandlers } from "./contact/handlers";
import { JwtSecretRpcHandlers } from "./jwt-secret/handlers";
import { MembershipRpcHandlers } from "./membership/handlers";
import { OrganizationRpcHandlers } from "./organization/handlers";
import { PostRpcHandlers } from "./post/handlers";
import { PostReactionRpcHandlers } from "./post-reaction/handlers";
import { PostStatusRpcHandlers } from "./post-status/handlers";
import { PostSubscriptionRpcHandlers } from "./post-subscription/handlers";
import { AllRpcs } from "./rpc-group";
import {
  AuthMiddlewareLive,
  OptionalAuthMiddlewareLive,
} from "./session-middleware";
import { SiteRpcHandlers } from "./site/handlers";
import { TagRpcHandlers } from "./tag/handlers";
import { UpvoteRpcHandlers } from "./upvote/handlers";
import { WorkspaceRpcHandlers } from "./workspace/handlers";

export const RpcRoute = RpcServer.layerHttp({
  path: "/rpc",
  protocol: "http",
  group: AllRpcs,
}).pipe(
  Layer.provide(PostRpcHandlers),
  Layer.provide(BillingRpcHandlers),
  Layer.provide(BoardRpcHandlers),
  Layer.provide(ChangelogRpcHandlers),
  Layer.provide(JwtSecretRpcHandlers),
  Layer.provide(MembershipRpcHandlers),
  Layer.provide(OrganizationRpcHandlers),
  Layer.provide(CommentReactionRpcHandlers),
  Layer.provide(CommentRpcHandlers),
  Layer.provide(Layer.merge(CompanyRpcHandlers, ContactRpcHandlers)),
  Layer.provide(SiteRpcHandlers),
  Layer.provide(TagRpcHandlers),
  Layer.provide(UpvoteRpcHandlers),
  Layer.provide(PostReactionRpcHandlers),
  Layer.provide(PostStatusRpcHandlers),
  Layer.provide(PostSubscriptionRpcHandlers),
  Layer.provide(WorkspaceRpcHandlers),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(OptionalAuthMiddlewareLive)
);
