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

export const AllRpcs = PostRpcs.merge(PostActivityRpcs).merge(
  AttributeDefinitionRpcs,
  BillingRpcs,
  BoardRpcs,
  ChangelogRpcs.merge(ChangelogPostRpcs, ChangelogCategoryRpcs).merge(
    ChangelogSubscriptionRpcs
  ),
  JwtSecretRpcs,
  MembershipRpcs,
  NotificationRpcs,
  OrganizationRpcs,
  CommentReactionRpcs,
  CommentRpcs,
  CompanyRpcs,
  SiteRpcs,
  TagRpcs,
  UpvoteRpcs,
  PostReactionRpcs,
  PostStatusRpcs,
  PostSubscriptionRpcs,
  RoadmapRpcs,
  RoadmapColumnRpcs,
  WorkspaceRpcs,
  ContactRpcs,
  EmailSubscriptionRpcs,
  WebhookManagementRpcs,
  SlackManagementRpcs,
  DiscordManagementRpcs,
  ExternalResourceRpcs,
  // GitHub RPC definitions are contracts; their handler layer is bound by the
  // composition root (see docs/adr/0002).
  GitHubManagementRpcs
);
