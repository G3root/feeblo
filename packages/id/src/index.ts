export * from "./legid";

import { makeLegid, makePrefixableLegid } from "./legid";

const approximateLength = 12;

export const OrganizationId = makePrefixableLegid("organization", "org", {
  approximateLength,
});
export const WorkspaceId = makePrefixableLegid("workspace", "org", {
  approximateLength,
});
export const ProjectId = makePrefixableLegid("project", "prj", {
  approximateLength,
});
export const MemberId = makePrefixableLegid("member", "mem", {
  approximateLength,
});
export const BoardId = makePrefixableLegid("board", "brd", {
  approximateLength,
});
export const PostStatusId = makePrefixableLegid("post_status", "pss", {
  approximateLength,
});
export const PostId = makePrefixableLegid("post", "pst", {
  approximateLength,
});
export const UpvoteId = makePrefixableLegid("upvote", "upv", {
  approximateLength,
});
export const CommentReactionId = makePrefixableLegid(
  "comment_reaction",
  "crt",
  { approximateLength }
);
export const CommentId = makePrefixableLegid("comment", "cmt", {
  approximateLength,
});
export const ReplyId = makePrefixableLegid("reply", "rpl", {
  approximateLength,
});
export const PostReactionId = makePrefixableLegid("post_reaction", "rct", {
  approximateLength,
});
export const SiteId = makePrefixableLegid("site", "sit", {
  approximateLength,
});
export const SubscriptionId = makePrefixableLegid("subscription", "sub", {
  approximateLength,
});
export const ChangelogId = makePrefixableLegid("changelog", "chg", {
  approximateLength,
});

export const PublicId = makeLegid("public", { approximateLength });
