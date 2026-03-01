import { relations } from "drizzle-orm/relations";
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
} from "./schema";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  twoFactors: many(twoFactor),
  members: many(member),
  invitations: many(invitation),
  upvotes: many(upvote),
  reactions: many(reaction),
  comments: many(comment),
  commentLikes: many(commentLike),
  createdPosts: many(post),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, {
    fields: [twoFactor.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many, one }) => ({
  members: many(member),
  invitations: many(invitation),
  boards: many(board),
  posts: many(post),
  comments: many(comment),
  site: one(site, {
    fields: [organization.id],
    references: [site.organizationId],
  }),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const boardRelations = relations(board, ({ many, one }) => ({
  organization: one(organization, {
    fields: [board.organizationId],
    references: [organization.id],
  }),
  posts: many(post),
}));

export const postRelations = relations(post, ({ many, one }) => ({
  board: one(board, {
    fields: [post.boardId],
    references: [board.id],
  }),
  organization: one(organization, {
    fields: [post.organizationId],
    references: [organization.id],
  }),
  creator: one(user, {
    fields: [post.creatorId],
    references: [user.id],
  }),
  creatorMember: one(member, {
    fields: [post.creatorMemberId],
    references: [member.id],
  }),
  upvotes: many(upvote),
  reactions: many(reaction),
  comments: many(comment),
}));

export const upvoteRelations = relations(upvote, ({ one }) => ({
  user: one(user, {
    fields: [upvote.userId],
    references: [user.id],
  }),
  post: one(post, {
    fields: [upvote.postId],
    references: [post.id],
  }),
}));

export const reactionRelations = relations(reaction, ({ one }) => ({
  user: one(user, {
    fields: [reaction.userId],
    references: [user.id],
  }),
  post: one(post, {
    fields: [reaction.postId],
    references: [post.id],
  }),
}));

export const commentRelations = relations(comment, ({ many, one }) => ({
  organization: one(organization, {
    fields: [comment.organizationId],
    references: [organization.id],
  }),
  post: one(post, {
    fields: [comment.postId],
    references: [post.id],
  }),
  user: one(user, {
    fields: [comment.userId],
    references: [user.id],
  }),
  parentComment: one(comment, {
    fields: [comment.parentCommentId],
    references: [comment.id],
    relationName: "commentReplies",
  }),
  replies: many(comment, {
    relationName: "commentReplies",
  }),
  commentLikes: many(commentLike),
}));

export const commentLikeRelations = relations(commentLike, ({ one }) => ({
  user: one(user, {
    fields: [commentLike.userId],
    references: [user.id],
  }),
  comment: one(comment, {
    fields: [commentLike.commentId],
    references: [comment.id],
  }),
}));

export const siteRelations = relations(site, ({ one }) => ({
  organization: one(organization, {
    fields: [site.organizationId],
    references: [organization.id],
  }),
}));
