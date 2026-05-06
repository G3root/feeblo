import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    twoFactors: r.many.twoFactor(),
    members: r.many.member(),
    invitations: r.many.invitation(),
    upvotes: r.many.upvote(),
    postReactions: r.many.postReaction(),
    comments: r.many.comment(),
    commentReactions: r.many.commentReaction(),
    createdPosts: r.many.post(),
    createdChangelogs: r.many.changelog(),
    createdTags: r.many.tag(),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
    }),
  },
  twoFactor: {
    user: r.one.user({
      from: r.twoFactor.userId,
      to: r.user.id,
    }),
  },
  organization: {
    members: r.many.member(),
    invitations: r.many.invitation(),
    boards: r.many.board(),
    tags: r.many.tag(),
    postStatuses: r.many.postStatus(),
    posts: r.many.post(),
    postTags: r.many.postTag(),
    comments: r.many.comment(),
    changelogs: r.many.changelog(),
    changelogTags: r.many.changelogTag(),
    site: r.one.site({
      from: r.organization.id,
      to: r.site.organizationId,
    }),
    subscriptions: r.many.subscription(),
  },
  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.member.userId,
      to: r.user.id,
    }),
  },
  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
    }),
  },
  board: {
    organization: r.one.organization({
      from: r.board.organizationId,
      to: r.organization.id,
    }),
    posts: r.many.post(),
  },
  tag: {
    organization: r.one.organization({
      from: r.tag.organizationId,
      to: r.organization.id,
    }),
    creator: r.one.user({
      from: r.tag.creatorId,
      to: r.user.id,
    }),
    creatorMember: r.one.member({
      from: r.tag.creatorMemberId,
      to: r.member.id,
    }),
    postTags: r.many.postTag(),
    changelogTags: r.many.changelogTag(),
  },
  postTag: {
    post: r.one.post({
      from: r.postTag.postId,
      to: r.post.id,
    }),
    tag: r.one.tag({
      from: r.postTag.tagId,
      to: r.tag.id,
    }),
    organization: r.one.organization({
      from: r.postTag.organizationId,
      to: r.organization.id,
    }),
  },
  postStatus: {
    organization: r.one.organization({
      from: r.postStatus.organizationId,
      to: r.organization.id,
    }),
    posts: r.many.post(),
  },
  post: {
    board: r.one.board({
      from: r.post.boardId,
      to: r.board.id,
    }),
    organization: r.one.organization({
      from: r.post.organizationId,
      to: r.organization.id,
    }),
    postStatus: r.one.postStatus({
      from: r.post.statusId,
      to: r.postStatus.id,
    }),
    creator: r.one.user({
      from: r.post.creatorId,
      to: r.user.id,
    }),
    creatorMember: r.one.member({
      from: r.post.creatorMemberId,
      to: r.member.id,
    }),
    upvotes: r.many.upvote(),
    postReactions: r.many.postReaction(),
    comments: r.many.comment(),
    postTags: r.many.postTag(),
  },
  upvote: {
    user: r.one.user({
      from: r.upvote.userId,
      to: r.user.id,
    }),
    post: r.one.post({
      from: r.upvote.postId,
      to: r.post.id,
    }),
  },
  postReaction: {
    user: r.one.user({
      from: r.postReaction.userId,
      to: r.user.id,
    }),
    post: r.one.post({
      from: r.postReaction.postId,
      to: r.post.id,
    }),
  },
  comment: {
    organization: r.one.organization({
      from: r.comment.organizationId,
      to: r.organization.id,
    }),
    post: r.one.post({
      from: r.comment.postId,
      to: r.post.id,
    }),
    user: r.one.user({
      from: r.comment.userId,
      to: r.user.id,
    }),
    parentComment: r.one.comment({
      from: r.comment.parentCommentId,
      to: r.comment.id,
      alias: "commentReplies",
    }),
    replies: r.many.comment({
      alias: "commentReplies",
    }),
    commentReactions: r.many.commentReaction(),
  },
  commentReaction: {
    user: r.one.user({
      from: r.commentReaction.userId,
      to: r.user.id,
    }),
    comment: r.one.comment({
      from: r.commentReaction.commentId,
      to: r.comment.id,
    }),
  },
  site: {
    organization: r.one.organization({
      from: r.site.organizationId,
      to: r.organization.id,
    }),
  },
  changelog: {
    organization: r.one.organization({
      from: r.changelog.organizationId,
      to: r.organization.id,
    }),
    creator: r.one.user({
      from: r.changelog.creatorId,
      to: r.user.id,
    }),
    creatorMember: r.one.member({
      from: r.changelog.creatorMemberId,
      to: r.member.id,
    }),
    changelogTags: r.many.changelogTag(),
  },
  changelogTag: {
    changelog: r.one.changelog({
      from: r.changelogTag.changelogId,
      to: r.changelog.id,
    }),
    tag: r.one.tag({
      from: r.changelogTag.tagId,
      to: r.tag.id,
    }),
    organization: r.one.organization({
      from: r.changelogTag.organizationId,
      to: r.organization.id,
    }),
  },
  subscription: {
    organization: r.one.organization({
      from: r.subscription.organizationId,
      to: r.organization.id,
    }),
    product: r.one.product({
      from: r.subscription.productId,
      to: r.product.id,
    }),
  },
  product: {
    subscriptions: r.many.subscription(),
  },
}));
