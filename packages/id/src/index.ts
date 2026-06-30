/** biome-ignore-all lint/performance/noBarrelFile: <explanation> */
export * from "./legid";

import { makeId } from "./legid";

const approximateLength = 12;

export const OrganizationId = makeId("organization", "org", {
  approximateLength,
});
export const WorkspaceId = makeId("workspace", "org", {
  approximateLength,
});
export const ProjectId = makeId("project", "prj", {
  approximateLength,
});
export const MemberId = makeId("member", "mem", {
  approximateLength,
});
export const BoardId = makeId("board", "brd", {
  approximateLength,
});
export const PostStatusId = makeId("post_status", "pss", {
  approximateLength,
});
export const PostId = makeId("post", "pst", {
  approximateLength,
});
export const UpvoteId = makeId("upvote", "upv", {
  approximateLength,
});
export const CommentReactionId = makeId("comment_reaction", "crt", {
  approximateLength,
});
export const CommentId = makeId("comment", "cmt", {
  approximateLength,
});
export const ReplyId = makeId("reply", "rpl", {
  approximateLength,
});
export const PostReactionId = makeId("post_reaction", "rct", {
  approximateLength,
});
export const PostSubscriptionId = makeId("post_subscription", "psb", {
  approximateLength,
});
export const SiteId = makeId("site", "sit", {
  approximateLength,
});
export const SubscriptionId = makeId("subscription", "sub", {
  approximateLength,
});
export const ChangelogId = makeId("changelog", "chg", {
  approximateLength,
});

export const TagId = makeId("tag", "tag", {
  approximateLength,
});

export const PostTagId = makeId("post_tag", "ptg", {
  approximateLength,
});

export const ChangelogTagId = makeId("changelog_tag", "ctg", {
  approximateLength,
});
