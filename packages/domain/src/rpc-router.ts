import * as Layer from "effect/Layer";

import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

import { AttributeDefinitionRpcHandlers } from "./attribute-definition/handlers";
import { BillingRpcHandlers } from "./billing/handlers";
import { BoardRpcHandlers } from "./board/handlers";
import { ChangelogRpcHandlers } from "./changelog/handlers";
import { ChangelogPostRpcHandlers } from "./changelog-post/handlers";
import { CommentReactionRpcHandlers } from "./comment-reaction/handlers";
import { CommentRpcHandlers } from "./comments/handlers";
import { CompanyRpcHandlers } from "./company/handlers";
import { ContactRpcHandlers } from "./contact/handlers";
import { JwtSecretRpcHandlers } from "./jwt-secret/handlers";
import { MembershipRpcHandlers } from "./membership/handlers";
import { NotificationRpcHandlers } from "./notification/handlers";
import { OrganizationRpcHandlers } from "./organization/handlers";
import { PostRpcHandlers } from "./post/handlers";
import { PostActivityRpcHandlers } from "./post-activity/handlers";
import { PostReactionRpcHandlers } from "./post-reaction/handlers";
import { PostStatusRpcHandlers } from "./post-status/handlers";
import { PostSubscriptionRpcHandlers } from "./post-subscription/handlers";
import { PublicRpcRateLimitMiddlewareLive } from "./rate-limit";
import { RoadmapRpcHandlers } from "./roadmap/handlers";
import { RoadmapColumnRpcHandlers } from "./roadmap-column/handlers";
import { AllRpcs } from "./rpc-group";
import { S3UploadServiceLive } from "./services/s3";
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
  Layer.provide(Layer.merge(PostRpcHandlers, PostActivityRpcHandlers)),
  Layer.provide(BillingRpcHandlers),
  Layer.provide(BoardRpcHandlers),
  Layer.provide(Layer.mergeAll(ChangelogRpcHandlers, ChangelogPostRpcHandlers)),
  Layer.provide(JwtSecretRpcHandlers),
  Layer.provide(Layer.mergeAll(MembershipRpcHandlers, NotificationRpcHandlers)),
  Layer.provide(OrganizationRpcHandlers),
  Layer.provide(CommentReactionRpcHandlers),
  Layer.provide(CommentRpcHandlers),
  Layer.provide(
    Layer.mergeAll(
      AttributeDefinitionRpcHandlers,
      CompanyRpcHandlers,
      ContactRpcHandlers
    )
  ),
  Layer.provide(SiteRpcHandlers),
  Layer.provide(TagRpcHandlers),
  Layer.provide(UpvoteRpcHandlers),
  Layer.provide(PostReactionRpcHandlers),
  Layer.provide(PostStatusRpcHandlers),
  Layer.provide(
    Layer.mergeAll(
      PostSubscriptionRpcHandlers,
      RoadmapRpcHandlers,
      RoadmapColumnRpcHandlers
    )
  ),
  Layer.provide(WorkspaceRpcHandlers),
  Layer.provide(S3UploadServiceLive),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(
    Layer.mergeAll(
      AuthMiddlewareLive,
      OptionalAuthMiddlewareLive,
      PublicRpcRateLimitMiddlewareLive
    )
  )
);
