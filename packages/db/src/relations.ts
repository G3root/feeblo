import { defineRelations } from "drizzle-orm/relations";
import {
  account,
  board,
  comment,
  commentLike,
  invitation,
  member,
  organization,
  post,
  reaction,
  session,
  site,
  twoFactor,
  upvote,
  user,
  verification,
} from "./schema";

export const relations = defineRelations(
  {
    user,
    session,
    account,
    verification,
    twoFactor,
    organization,
    member,
    invitation,
    board,
    post,
    upvote,
    reaction,
    commentEntity: comment,
    commentLikeEntity: commentLike,
    site,
  },
  (r) => ({
    user: {
      sessions: r.many.session({
        from: r.user.id,
        to: r.session.userId,
      }),
      accounts: r.many.account({
        from: r.user.id,
        to: r.account.userId,
      }),
      twoFactors: r.many.twoFactor({
        from: r.user.id,
        to: r.twoFactor.userId,
      }),
      members: r.many.member({
        from: r.user.id,
        to: r.member.userId,
      }),
      invitations: r.many.invitation({
        from: r.user.id,
        to: r.invitation.inviterId,
      }),
      upvotes: r.many.upvote({
        from: r.user.id,
        to: r.upvote.userId,
      }),
      reactions: r.many.reaction({
        from: r.user.id,
        to: r.reaction.userId,
      }),
      comments: r.many.commentEntity({
        from: r.user.id,
        to: r.commentEntity.userId,
      }),
      commentLikes: r.many.commentLikeEntity({
        from: r.user.id,
        to: r.commentLikeEntity.userId,
      }),
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
      members: r.many.member({
        from: r.organization.id,
        to: r.member.organizationId,
      }),
      invitations: r.many.invitation({
        from: r.organization.id,
        to: r.invitation.organizationId,
      }),
      boards: r.many.board({
        from: r.organization.id,
        to: r.board.organizationId,
      }),
      posts: r.many.post({
        from: r.organization.id,
        to: r.post.organizationId,
      }),
      comments: r.many.commentEntity({
        from: r.organization.id,
        to: r.commentEntity.organizationId,
      }),
      site: r.one.site({
        from: r.organization.id,
        to: r.site.organizationId,
      }),
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
      posts: r.many.post({
        from: r.board.id,
        to: r.post.boardId,
      }),
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
      upvotes: r.many.upvote({
        from: r.post.id,
        to: r.upvote.postId,
      }),
      reactions: r.many.reaction({
        from: r.post.id,
        to: r.reaction.postId,
      }),
      comments: r.many.commentEntity({
        from: r.post.id,
        to: r.commentEntity.postId,
      }),
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
    reaction: {
      user: r.one.user({
        from: r.reaction.userId,
        to: r.user.id,
      }),
      post: r.one.post({
        from: r.reaction.postId,
        to: r.post.id,
      }),
    },
    commentEntity: {
      organization: r.one.organization({
        from: r.commentEntity.organizationId,
        to: r.organization.id,
      }),
      post: r.one.post({
        from: r.commentEntity.postId,
        to: r.post.id,
      }),
      user: r.one.user({
        from: r.commentEntity.userId,
        to: r.user.id,
      }),
      parentComment: r.one.commentEntity({
        from: r.commentEntity.parentCommentId,
        to: r.commentEntity.id,
      }),
      replies: r.many.commentEntity({
        from: r.commentEntity.id,
        to: r.commentEntity.parentCommentId,
      }),
      commentLikes: r.many.commentLikeEntity({
        from: r.commentEntity.id,
        to: r.commentLikeEntity.commentId,
      }),
    },
    commentLikeEntity: {
      user: r.one.user({
        from: r.commentLikeEntity.userId,
        to: r.user.id,
      }),
      comment: r.one.commentEntity({
        from: r.commentLikeEntity.commentId,
        to: r.commentEntity.id,
      }),
    },
    site: {
      organization: r.one.organization({
        from: r.site.organizationId,
        to: r.organization.id,
      }),
    },
  })
);
