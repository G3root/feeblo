import { BillingRpcs } from "./billing/rpcs";
import { BoardRpcs } from "./board/rpcs";
import { ChangelogRpcs } from "./changelog/rpcs";
import { CommentReactionRpcs } from "./comment-reaction/rpcs";
import { CommentRpcs } from "./comments/rpcs";
import { CompanyRpcs } from "./company/rpcs";
import { ContactRpcs } from "./contact/rpcs";
import { JwtSecretRpcs } from "./jwt-secret/rpcs";
import { MembershipRpcs } from "./membership/rpcs";
import { OrganizationRpcs } from "./organization/rpcs";
import { PostRpcs } from "./post/rpcs";
import { PostReactionRpcs } from "./post-reaction/rpcs";
import { PostStatusRpcs } from "./post-status/rpcs";
import { PostSubscriptionRpcs } from "./post-subscription/rpcs";
import { SiteRpcs } from "./site/rpcs";
import { TagRpcs } from "./tag/rpcs";
import { UpvoteRpcs } from "./upvote/rpcs";
import { WorkspaceRpcs } from "./workspace/rpcs";

export const AllRpcs = PostRpcs.merge(
  BillingRpcs,
  BoardRpcs,
  ChangelogRpcs,
  JwtSecretRpcs,
  MembershipRpcs,
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
  WorkspaceRpcs,
  ContactRpcs
);
