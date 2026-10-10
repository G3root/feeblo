import { ApiKeyRpcs } from "./api-key/rpcs";
import { AttributeDefinitionRpcs } from "./attribute-definition/rpcs";
import { BillingRpcs } from "./billing/rpcs";
import { BoardRpcs } from "./board/rpcs";
import { ChangelogCategoryRpcs } from "./changelog-category/rpcs";
import { ChangelogPostRpcs } from "./changelog-post/rpcs";
import { ChangelogSubscriptionRpcs } from "./changelog-subscription/rpcs";
import { ChangelogRpcs } from "./changelog/rpcs";
import { CommentReactionRpcs } from "./comment-reaction/rpcs";
import { CommentRpcs } from "./comments/rpcs";
import { CompanyRpcs } from "./company/rpcs";
import { ContactRpcs } from "./contact/rpcs";
import { EmailSubscriptionRpcs } from "./email-subscription/rpcs";
import { DiscordManagementRpcs } from "./integration/discord/rpcs";
import { ExternalResourceRpcs } from "./integration/external-resource/rpcs";
import { GitHubManagementRpcs } from "./integration/github/rpcs";
import { WebhookManagementRpcs } from "./integration/rpcs";
import { SlackManagementRpcs } from "./integration/slack/rpcs";
import { JwtSecretRpcs } from "./jwt-secret/rpcs";
import { MembershipRpcs } from "./membership/rpcs";
import { NotificationPreferenceRpcs } from "./notification-preference/rpcs";
import { NotificationRpcs } from "./notification/rpcs";
import { OrganizationRpcs } from "./organization/rpcs";
import { PostActivityRpcs } from "./post-activity/rpcs";
import { PostReactionRpcs } from "./post-reaction/rpcs";
import { PostStatusRpcs } from "./post-status/rpcs";
import { PostSubscriptionRpcs } from "./post-subscription/rpcs";
import { PostRpcs } from "./post/rpcs";
import { RoadmapColumnRpcs } from "./roadmap-column/rpcs";
import { RoadmapRpcs } from "./roadmap/rpcs";
import { SiteRpcs } from "./site/rpcs";
import { TagRpcs } from "./tag/rpcs";
import { UpvoteRpcs } from "./upvote/rpcs";
import { WorkspaceRpcs } from "./workspace/rpcs";

/**
 * Every RPC group this package defines, named so the handler registry in
 * `rpc-router.ts` can pair each one with its layer under a key the type
 * checker understands.
 *
 * This list stays free of handler imports on purpose: the dashboard and the
 * public board bundle `AllRpcs` into the browser through `@feeblo/rpc-client`,
 * and a handler layer imports repositories and the database. The pairing list
 * therefore lives in the server module, and `rpc-router.ts` uses
 * `satisfies Record<RpcGroupName, …>` so a group added here without an entry
 * there is a compile error rather than a request that dies at runtime.
 * `rpc-router.test.ts` pins the same set at runtime.
 *
 * Provider-owned groups are listed here like any other — the domain still
 * defines their contract (`docs/adr/0002` keeps the handler layers in
 * `integrations/*`), so `AllRpcs` covers every group while the four provider
 * entries are marked `"provider"` in the handler registry and supplied by the
 * composition root.
 */
export const RpcGroups = [
  ["Post", PostRpcs],
  ["PostActivity", PostActivityRpcs],
  ["AttributeDefinition", AttributeDefinitionRpcs],
  ["Billing", BillingRpcs],
  ["Board", BoardRpcs],
  ["Changelog", ChangelogRpcs],
  ["ChangelogPost", ChangelogPostRpcs],
  ["ChangelogCategory", ChangelogCategoryRpcs],
  ["ChangelogSubscription", ChangelogSubscriptionRpcs],
  ["JwtSecret", JwtSecretRpcs],
  ["ApiKey", ApiKeyRpcs],
  ["Membership", MembershipRpcs],
  ["Notification", NotificationRpcs],
  ["NotificationPreference", NotificationPreferenceRpcs],
  ["Organization", OrganizationRpcs],
  ["CommentReaction", CommentReactionRpcs],
  ["Comment", CommentRpcs],
  ["Company", CompanyRpcs],
  ["Site", SiteRpcs],
  ["Tag", TagRpcs],
  ["Upvote", UpvoteRpcs],
  ["PostReaction", PostReactionRpcs],
  ["PostStatus", PostStatusRpcs],
  ["PostSubscription", PostSubscriptionRpcs],
  ["Roadmap", RoadmapRpcs],
  ["RoadmapColumn", RoadmapColumnRpcs],
  ["Workspace", WorkspaceRpcs],
  ["Contact", ContactRpcs],
  ["EmailSubscription", EmailSubscriptionRpcs],
  ["ExternalResource", ExternalResourceRpcs],
  ["WebhookManagement", WebhookManagementRpcs],
  ["SlackManagement", SlackManagementRpcs],
  ["DiscordManagement", DiscordManagementRpcs],
  // GitHub RPC definitions are contracts; their handler layer is bound by the
  // composition root (see docs/adr/0002).
  ["GitHubManagement", GitHubManagementRpcs],
] as const;

/** The key a handler registration in `rpc-router.ts` uses for a group. */
export type RpcGroupName = (typeof RpcGroups)[number][0];

/**
 * Every RPC group, merged once.
 *
 * Derived from `RpcGroups` rather than restated, so the group list has one
 * home. The variadic `merge` accumulates the procedure union at the type
 * level, and `rpc-router.test.ts` checks the runtime result covers exactly the
 * registered groups.
 */
export const AllRpcs = (() => {
  const [first, ...rest] = RpcGroups;
  return first[1].merge(...rest.map(([, group]) => group));
})();
