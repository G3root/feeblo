import * as Layer from "effect/Layer";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";

import { ApiKeyRpcHandlers } from "./api-key/handlers";
import { AttributeDefinitionRpcHandlers } from "./attribute-definition/handlers";
import { BillingRpcHandlers } from "./billing/handlers";
import { BoardRpcHandlers } from "./board/handlers";
import { ChangelogCategoryRpcHandlers } from "./changelog-category/handlers";
import { ChangelogPostRpcHandlers } from "./changelog-post/handlers";
import { ChangelogSubscriptionRpcHandlers } from "./changelog-subscription/handlers";
import { ChangelogRpcHandlers } from "./changelog/handlers";
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
import { AllRpcs, type RpcGroupName } from "./rpc-group";
import { S3UploadServiceLive } from "./services/s3";
import {
  AuthMiddlewareLive,
  OptionalAuthMiddlewareLive,
  PublicAuthMiddlewareLive,
} from "./session-middleware";
import { SiteRpcHandlers } from "./site/handlers";
import { TagRpcHandlers } from "./tag/handlers";
import { UpvoteRpcHandlers } from "./upvote/handlers";
import { WorkspaceRpcHandlers } from "./workspace/handlers";

/**
 * The handler layer for every group in `RpcGroups`, or `"provider"` for the
 * groups whose layer a provider package owns and the composition root supplies
 * (see docs/adr/0002).
 *
 * This record is the pairing the two hand-maintained lists used to be: adding
 * a group to `RpcGroups` is a compile error here until it is paired, and the
 * `satisfies` below is what fails — not a request, which is how the hazard was
 * recorded in `AGENTS.md`. The domain handler layers are merged in one place
 * from this record, so no route builder decides which layers travel together.
 *
 * The four provider entries name groups the domain still defines; only their
 * handler layers live in `integrations/*`. `ProviderOwnedRpcName` derives the
 * key set from exactly those entries, and the composition root's map satisfies
 * it, so a fifth provider-owned group cannot be half-wired either.
 */
export const RpcHandlerRegistrations = {
  Post: PostRpcHandlers,
  PostActivity: PostActivityRpcHandlers,
  AttributeDefinition: AttributeDefinitionRpcHandlers,
  Billing: BillingRpcHandlers,
  Board: BoardRpcHandlers,
  Changelog: ChangelogRpcHandlers,
  ChangelogPost: ChangelogPostRpcHandlers,
  ChangelogCategory: ChangelogCategoryRpcHandlers,
  ChangelogSubscription: ChangelogSubscriptionRpcHandlers,
  JwtSecret: JwtSecretRpcHandlers,
  ApiKey: ApiKeyRpcHandlers,
  Membership: MembershipRpcHandlers,
  Notification: NotificationRpcHandlers,
  Organization: OrganizationRpcHandlers,
  CommentReaction: CommentReactionRpcHandlers,
  Comment: CommentRpcHandlers,
  Company: CompanyRpcHandlers,
  Site: SiteRpcHandlers,
  Tag: TagRpcHandlers,
  Upvote: UpvoteRpcHandlers,
  PostReaction: PostReactionRpcHandlers,
  PostStatus: PostStatusRpcHandlers,
  PostSubscription: PostSubscriptionRpcHandlers,
  Roadmap: RoadmapRpcHandlers,
  RoadmapColumn: RoadmapColumnRpcHandlers,
  Workspace: WorkspaceRpcHandlers,
  Contact: ContactRpcHandlers,
  EmailSubscription: EmailSubscriptionRpcHandlers,
  ExternalResource: ExternalResourceRpcHandlers,
  WebhookManagement: "provider",
  SlackManagement: "provider",
  DiscordManagement: "provider",
  GitHubManagement: "provider",
} satisfies Record<RpcGroupName, Layer.Layer<any, any, any> | "provider">;

type RegisteredHandlerValue = (typeof RpcHandlerRegistrations)[RpcGroupName];

/** A handler layer this package binds. */
type DomainHandlerLayer = Exclude<RegisteredHandlerValue, "provider">;

/**
 * The keys whose handler layer the composition root supplies, derived from the
 * record above rather than written out again.
 */
export type ProviderOwnedRpcName = {
  [
    Name in RpcGroupName
  ]: (typeof RpcHandlerRegistrations)[Name] extends "provider" ? Name : never;
}[RpcGroupName];

/** The provider-owned keys, for a test that publishes the expected set. */
export const ProviderOwnedRpcNames =
  // SAFETY: the record is declared with `satisfies Record<RpcGroupName, …>`,
  // so its keys are exactly the names in that union.
  (Object.keys(RpcHandlerRegistrations) as RpcGroupName[]).filter(
    (name): name is ProviderOwnedRpcName =>
      RpcHandlerRegistrations[name] === "provider"
  );

/**
 * Every in-domain handler layer, merged once.
 *
 * The assertion is safe because the record covers every group by its
 * `satisfies`, so the filter leaves exactly the non-provider entries; the
 * non-empty tuple keeps `Layer.mergeAll`'s variadic signature honest. The
 * union of layer types distributes through `mergeAll`, so the route's
 * requirement channel is the union of every handler's dependencies — a
 * collaborator no root layer supplies still fails the build's type.
 */
export const DomainRpcHandlers = Layer.mergeAll(
  // SAFETY: the record covers every group by its `satisfies`, so the filter
  // leaves exactly the non-provider entries; the tuple assertion only states
  // that the record is non-empty, which `RpcGroupName` guarantees.
  ...(Object.values(RpcHandlerRegistrations).filter(
    (entry): entry is DomainHandlerLayer => entry !== "provider"
  ) as [DomainHandlerLayer, ...DomainHandlerLayer[]])
);

/**
 * Span-name prefix every RPC server span carries.
 *
 * Pinned here rather than left to `effect/rpc`'s default so the telemetry
 * layer, which reads this contract to add the per-method `rpc.*` attributes
 * (and to label the parent HTTP span), cannot silently stop matching after an
 * upgrade. The value matches the library default, so span names are unchanged.
 */
export const rpcSpanPrefix = "RpcServer";

/**
 * Builds the `/rpc` route with the provider-owned handler layers the
 * composition root supplies.
 *
 * `AllRpcs` and `DomainRpcHandlers` are derived from the same registry, so
 * this function never chooses which groups to bind; it binds every group the
 * provider argument does not own. The middleware and serialization a route
 * always needs are provided here, and the rest of the requirements stay on the
 * returned layer for the composition root to supply.
 */
export const makeRpcRoute = <RIn, ROut, E>(
  providerHandlers: Layer.Layer<ROut, E, RIn>
) =>
  RpcServer.layerHttp({
    path: "/rpc",
    protocol: "http",
    group: AllRpcs,
    spanPrefix: rpcSpanPrefix,
  }).pipe(
    Layer.provide(DomainRpcHandlers),
    Layer.provide(providerHandlers),
    Layer.provide(S3UploadServiceLive),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(
      Layer.mergeAll(
        AuthMiddlewareLive,
        OptionalAuthMiddlewareLive,
        PublicAuthMiddlewareLive,
        PublicRpcRateLimitMiddlewareLive
      )
    )
  );
