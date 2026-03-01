import { BoardRpcs } from "./board/rpcs";
import { CommentRpcs } from "./comments/rpcs";
import { MembershipRpcs } from "./membership/rpcs";
import { PostRpcs } from "./post/rpcs";
import { SiteRpcs } from "./site/rpcs";
import { UpvoteRpcs } from "./upvote/rpcs";

export const AllRpcs = PostRpcs.merge(
  BoardRpcs,
  MembershipRpcs,
  CommentRpcs,
  SiteRpcs,
  UpvoteRpcs
);
