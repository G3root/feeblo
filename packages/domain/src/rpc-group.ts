import { BoardRpcs } from "./board/rpcs";
import { MembershipRpcs } from "./membership/rpcs";
import { PostRpcs } from "./post/rpcs";
import { UserRpcs } from "./user/rpcs";

export const AllRpcs = PostRpcs.merge(UserRpcs, BoardRpcs, MembershipRpcs);
