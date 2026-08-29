import * as Layer from "effect/Layer";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

import { AttributeDefinitionRpcHandlers } from "./attribute-definition/handlers";
import { BillingRpcHandlers } from "./billing/handlers";
import { BoardRpcHandlers } from "./board/handlers";
import { ChangelogCategoryRpcHandlers } from "./changelog-category/handlers";
import { ChangelogPostRpcHandlers } from "./changelog-post/handlers";
import { ChangelogRpcHandlers } from "./changelog/handlers";
import { ChangelogSubscriptionRpcHandlers } from "./changelog-subscription/handlers";
import { CommentReactionRpcHandlers } from "./comment-reaction/handlers";
import { CommentRpcHandlers } from "./comments/handlers";
import { CompanyRpcHandlers } from "./company/handlers";
import { ContactRpcHandlers } from "./contact/handlers";
import { EmailSubscriptionRpcHandlers } from "./email-subscription/handlers";
import { ExternalResourceRpcHandlers } from "./integration/external-resource/handlers";
import { JwtSecretRpcHandlers } from "./jwt-secret/handlers";
import { MembershipRpcHandlers } from "./membership/handlers";
import { NotificationRpcHandlers } from "./notification/handlers";
import { OrganizationRpcHandlers } from "./organization/handlers";
import { PostActivityRpcHandlers } from "./post-activity/handlers";
import { PostReactionRpcHandlers } from "./post-reaction/handlers";
import { PostStatusRpcHandlers } from "./post-status/handlers";
import { PostSubscriptionRpcHandlers } from "./post-subscription/handlers";
import { PostRpcHandlers } from "./post/handlers";
import { PublicRpcRateLimitMiddlewareLive } from "./rate-limit";
import { RoadmapColumnRpcHandlers } from "./roadmap-column/handlers";
import { RoadmapRpcHandlers } from "./roadmap/handlers";
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

/**
 * Core (non-provider) RPC handlers bound inside the domain package.
 */
export const CoreRpcHandlers = Layer.mergeAll(
  PostRpcHandlers,
  PostActivityRpcHandlers,
  ExternalResourceRpcHandlers
);

/**
 * Builds the `/rpc` route. Core handlers are bound here; provider-owned
 * handler layers are supplied by the composition root so the domain package
 * does not depend on provider packages (see docs/adr/0002).
 */
export const makeRpcRoute = <RIn, ROut, E>(
  providerHandlers: Layer.Layer<ROut, E, RIn>
) =>
  RpcServer.layerHttp({
    path: "/rpc",
    protocol: "http",
    group: AllRpcs,
  }).pipe(
    Layer.provide(CoreRpcHandlers),
    Layer.provide(providerHandlers),
    Layer.provide(BillingRpcHandlers),
    Layer.provide(
      Layer.mergeAll(BoardRpcHandlers, ChangelogCategoryRpcHandlers)
    ),
    Layer.provide(
      Layer.mergeAll(
        ChangelogRpcHandlers,
        ChangelogPostRpcHandlers,
        ChangelogSubscriptionRpcHandlers
      )
    ),
    Layer.provide(JwtSecretRpcHandlers),
    Layer.provide(
      Layer.mergeAll(MembershipRpcHandlers, NotificationRpcHandlers)
    ),
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
    Layer.provide(Layer.merge(SiteRpcHandlers, EmailSubscriptionRpcHandlers)),
    Layer.provide(Layer.merge(TagRpcHandlers, UpvoteRpcHandlers)),
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
