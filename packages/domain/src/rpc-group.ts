import { BoardRpcs } from "./board/rpcs";
import { CommentRpcs } from "./comments/rpcs";
import { MembershipRpcs } from "./membership/rpcs";
import { PostRpcs } from "./post/rpcs";

export const AllRpcs = PostRpcs.merge(BoardRpcs, MembershipRpcs, CommentRpcs);
