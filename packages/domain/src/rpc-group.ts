import { BoardRpcs } from "./board/rpcs";
import { CommentReactionRpcs } from "./comment-reaction/rpcs";
import { CommentRpcs } from "./comments/rpcs";
import { MembershipRpcs } from "./membership/rpcs";
import { PostRpcs } from "./post/rpcs";
import { PostReactionRpcs } from "./post-reaction/rpcs";
import { SiteRpcs } from "./site/rpcs";
import { UpvoteRpcs } from "./upvote/rpcs";

export const AllRpcs = PostRpcs.merge(
  BoardRpcs,
  MembershipRpcs,
  CommentReactionRpcs,
  CommentRpcs,
  SiteRpcs,
  UpvoteRpcs,
  PostReactionRpcs
);
