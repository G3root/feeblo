import { BillingRpcs } from "./billing/rpcs";
import { BoardRpcs } from "./board/rpcs";
import { ChangelogRpcs } from "./changelog/rpcs";
import { CommentReactionRpcs } from "./comment-reaction/rpcs";
import { CommentRpcs } from "./comments/rpcs";
import { MembershipRpcs } from "./membership/rpcs";
import { PostRpcs } from "./post/rpcs";
import { PostStatusRpcs } from "./post-status/rpcs";
import { PostReactionRpcs } from "./post-reaction/rpcs";
import { SiteRpcs } from "./site/rpcs";
import { TagRpcs } from "./tag/rpcs";
import { UpvoteRpcs } from "./upvote/rpcs";
import { WorkspaceRpcs } from "./workspace/rpcs";

export const AllRpcs = PostRpcs.merge(
  BillingRpcs,
  BoardRpcs,
  ChangelogRpcs,
  MembershipRpcs,
  CommentReactionRpcs,
  CommentRpcs,
  SiteRpcs,
  TagRpcs,
  UpvoteRpcs,
  PostReactionRpcs,
  PostStatusRpcs,
  WorkspaceRpcs
);
