import { relations } from "drizzle-orm/relations";
import {
  account,
  board,
  changelog,
  changelogTag,
  comment,
  commentReaction,
  invitation,
  member,
  organizationTable,
  post,
  postReaction,
  postStatus,
  postTag,
  productTable,
  session,
  site,
  subscriptionTable,
  tag,
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
  postReactions: many(postReaction),
  comments: many(comment),
  commentReactions: many(commentReaction),
  createdPosts: many(post),
  createdChangelogs: many(changelog),
  createdTags: many(tag),
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

export const organizationRelations = relations(
  organizationTable,
  ({ many, one }) => ({
    members: many(member),
    invitations: many(invitation),
    boards: many(board),
    tags: many(tag),
    postStatuses: many(postStatus),
    posts: many(post),
    postTags: many(postTag),
    comments: many(comment),
    changelogs: many(changelog),
    changelogTags: many(changelogTag),
    site: one(site, {
      fields: [organizationTable.id],
      references: [site.organizationId],
    }),
    subscriptions: many(subscriptionTable),
  })
);

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organizationTable, {
    fields: [member.organizationId],
    references: [organizationTable.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organizationTable, {
    fields: [invitation.organizationId],
    references: [organizationTable.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const boardRelations = relations(board, ({ many, one }) => ({
  organization: one(organizationTable, {
    fields: [board.organizationId],
    references: [organizationTable.id],
  }),
  posts: many(post),
}));

export const tagRelations = relations(tag, ({ many, one }) => ({
  organization: one(organizationTable, {
    fields: [tag.organizationId],
    references: [organizationTable.id],
  }),
  creator: one(user, {
    fields: [tag.creatorId],
    references: [user.id],
  }),
  creatorMember: one(member, {
    fields: [tag.creatorMemberId],
    references: [member.id],
  }),
  postTags: many(postTag),
  changelogTags: many(changelogTag),
}));

export const postTagRelations = relations(postTag, ({ one }) => ({
  post: one(post, {
    fields: [postTag.postId],
    references: [post.id],
  }),
  tag: one(tag, {
    fields: [postTag.tagId],
    references: [tag.id],
  }),
  organization: one(organizationTable, {
    fields: [postTag.organizationId],
    references: [organizationTable.id],
  }),
}));

export const postStatusRelations = relations(postStatus, ({ many, one }) => ({
  organization: one(organizationTable, {
    fields: [postStatus.organizationId],
    references: [organizationTable.id],
  }),
  posts: many(post),
}));

export const postRelations = relations(post, ({ many, one }) => ({
  board: one(board, {
    fields: [post.boardId],
    references: [board.id],
  }),
  organization: one(organizationTable, {
    fields: [post.organizationId],
    references: [organizationTable.id],
  }),
  postStatus: one(postStatus, {
    fields: [post.statusId],
    references: [postStatus.id],
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
  postReactions: many(postReaction),
  comments: many(comment),
  postTags: many(postTag),
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

export const postReactionRelations = relations(postReaction, ({ one }) => ({
  user: one(user, {
    fields: [postReaction.userId],
    references: [user.id],
  }),
  post: one(post, {
    fields: [postReaction.postId],
    references: [post.id],
  }),
}));

export const commentRelations = relations(comment, ({ many, one }) => ({
  organization: one(organizationTable, {
    fields: [comment.organizationId],
    references: [organizationTable.id],
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
  commentReactions: many(commentReaction),
}));

export const commentReactionRelations = relations(
  commentReaction,
  ({ one }) => ({
    user: one(user, {
      fields: [commentReaction.userId],
      references: [user.id],
    }),
    comment: one(comment, {
      fields: [commentReaction.commentId],
      references: [comment.id],
    }),
  })
);

export const siteRelations = relations(site, ({ one }) => ({
  organization: one(organizationTable, {
    fields: [site.organizationId],
    references: [organizationTable.id],
  }),
}));

export const changelogRelations = relations(changelog, ({ many, one }) => ({
  organization: one(organizationTable, {
    fields: [changelog.organizationId],
    references: [organizationTable.id],
  }),
  creator: one(user, {
    fields: [changelog.creatorId],
    references: [user.id],
  }),
  creatorMember: one(member, {
    fields: [changelog.creatorMemberId],
    references: [member.id],
  }),
  changelogTags: many(changelogTag),
}));

export const changelogTagRelations = relations(changelogTag, ({ one }) => ({
  changelog: one(changelog, {
    fields: [changelogTag.changelogId],
    references: [changelog.id],
  }),
  tag: one(tag, {
    fields: [changelogTag.tagId],
    references: [tag.id],
  }),
  organization: one(organizationTable, {
    fields: [changelogTag.organizationId],
    references: [organizationTable.id],
  }),
}));

export const subscriptionRelations = relations(
  subscriptionTable,
  ({ one }) => ({
    organization: one(organizationTable, {
      fields: [subscriptionTable.organizationId],
      references: [organizationTable.id],
    }),
    product: one(productTable, {
      fields: [subscriptionTable.productId],
      references: [productTable.id],
    }),
  })
);

export const productRelations = relations(productTable, ({ many }) => ({
  subscriptions: many(subscriptionTable),
}));
