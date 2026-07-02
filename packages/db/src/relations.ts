import { relations } from "drizzle-orm/relations";
import {
  accountTable,
  boardTable,
  changelogTable,
  changelogTagTable,
  commentReactionTable,
  commentTable,
  invitationTable,
  memberTable,
  organizationTable,
  postReactionTable,
  postStatusTable,
  postSubscriptionTable,
  postTable,
  postTagTable,
  productTable,
  sessionTable,
  siteTable,
  subscriptionTable,
  tagTable,
  twoFactorTable,
  upvoteTable,
  userTable,
} from "./schema";

export const userRelations = relations(userTable, ({ many }) => ({
  sessions: many(sessionTable),
  accounts: many(accountTable),
  twoFactors: many(twoFactorTable),
  members: many(memberTable),
  invitations: many(invitationTable),
  upvotes: many(upvoteTable),
  postReactions: many(postReactionTable),
  comments: many(commentTable),
  commentReactions: many(commentReactionTable),
  createdPosts: many(postTable),
  createdChangelogs: many(changelogTable),
  createdTags: many(tagTable),
  postSubscriptions: many(postSubscriptionTable),
}));

export const sessionRelations = relations(sessionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [sessionTable.userId],
    references: [userTable.id],
  }),
}));

export const accountRelations = relations(accountTable, ({ one }) => ({
  user: one(userTable, {
    fields: [accountTable.userId],
    references: [userTable.id],
  }),
}));

export const twoFactorRelations = relations(twoFactorTable, ({ one }) => ({
  user: one(userTable, {
    fields: [twoFactorTable.userId],
    references: [userTable.id],
  }),
}));

export const organizationRelations = relations(
  organizationTable,
  ({ many, one }) => ({
    members: many(memberTable),
    invitations: many(invitationTable),
    boards: many(boardTable),
    tags: many(tagTable),
    postStatuses: many(postStatusTable),
    posts: many(postTable),
    postTags: many(postTagTable),
    comments: many(commentTable),
    changelogs: many(changelogTable),
    changelogTags: many(changelogTagTable),
    site: one(siteTable, {
      fields: [organizationTable.id],
      references: [siteTable.organizationId],
    }),
    subscriptions: many(subscriptionTable),
  })
);

export const memberRelations = relations(memberTable, ({ one }) => ({
  organization: one(organizationTable, {
    fields: [memberTable.organizationId],
    references: [organizationTable.id],
  }),
  user: one(userTable, {
    fields: [memberTable.userId],
    references: [userTable.id],
  }),
}));

export const invitationRelations = relations(invitationTable, ({ one }) => ({
  organization: one(organizationTable, {
    fields: [invitationTable.organizationId],
    references: [organizationTable.id],
  }),
  user: one(userTable, {
    fields: [invitationTable.inviterId],
    references: [userTable.id],
  }),
}));

export const boardRelations = relations(boardTable, ({ many, one }) => ({
  organization: one(organizationTable, {
    fields: [boardTable.organizationId],
    references: [organizationTable.id],
  }),
  posts: many(postTable),
}));

export const tagRelations = relations(tagTable, ({ many, one }) => ({
  organization: one(organizationTable, {
    fields: [tagTable.organizationId],
    references: [organizationTable.id],
  }),
  creator: one(userTable, {
    fields: [tagTable.creatorId],
    references: [userTable.id],
  }),
  creatorMember: one(memberTable, {
    fields: [tagTable.creatorMemberId],
    references: [memberTable.id],
  }),
  postTags: many(postTagTable),
  changelogTags: many(changelogTagTable),
}));

export const postTagRelations = relations(postTagTable, ({ one }) => ({
  post: one(postTable, {
    fields: [postTagTable.postId],
    references: [postTable.id],
  }),
  tag: one(tagTable, {
    fields: [postTagTable.tagId],
    references: [tagTable.id],
  }),
  organization: one(organizationTable, {
    fields: [postTagTable.organizationId],
    references: [organizationTable.id],
  }),
}));

export const postStatusRelations = relations(
  postStatusTable,
  ({ many, one }) => ({
    organization: one(organizationTable, {
      fields: [postStatusTable.organizationId],
      references: [organizationTable.id],
    }),
    posts: many(postTable),
  })
);

export const postRelations = relations(postTable, ({ many, one }) => ({
  board: one(boardTable, {
    fields: [postTable.boardId],
    references: [boardTable.id],
  }),
  organization: one(organizationTable, {
    fields: [postTable.organizationId],
    references: [organizationTable.id],
  }),
  postStatus: one(postStatusTable, {
    fields: [postTable.statusId],
    references: [postStatusTable.id],
  }),
  creator: one(userTable, {
    fields: [postTable.creatorId],
    references: [userTable.id],
  }),
  creatorMember: one(memberTable, {
    fields: [postTable.creatorMemberId],
    references: [memberTable.id],
  }),
  upvotes: many(upvoteTable),
  postReactions: many(postReactionTable),
  comments: many(commentTable),
  postTags: many(postTagTable),
  subscriptions: many(postSubscriptionTable),
}));

export const postSubscriptionRelations = relations(
  postSubscriptionTable,
  ({ one }) => ({
    post: one(postTable, {
      fields: [postSubscriptionTable.postId],
      references: [postTable.id],
    }),
    user: one(userTable, {
      fields: [postSubscriptionTable.userId],
      references: [userTable.id],
    }),
    organization: one(organizationTable, {
      fields: [postSubscriptionTable.organizationId],
      references: [organizationTable.id],
    }),
  })
);

export const upvoteRelations = relations(upvoteTable, ({ one }) => ({
  user: one(userTable, {
    fields: [upvoteTable.userId],
    references: [userTable.id],
  }),
  post: one(postTable, {
    fields: [upvoteTable.postId],
    references: [postTable.id],
  }),
  organization: one(organizationTable, {
    fields: [upvoteTable.organizationId],
    references: [organizationTable.id],
  }),
}));

export const postReactionRelations = relations(
  postReactionTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [postReactionTable.userId],
      references: [userTable.id],
    }),
    post: one(postTable, {
      fields: [postReactionTable.postId],
      references: [postTable.id],
    }),
  })
);

export const commentRelations = relations(commentTable, ({ many, one }) => ({
  organization: one(organizationTable, {
    fields: [commentTable.organizationId],
    references: [organizationTable.id],
  }),
  post: one(postTable, {
    fields: [commentTable.postId],
    references: [postTable.id],
  }),
  user: one(userTable, {
    fields: [commentTable.userId],
    references: [userTable.id],
  }),
  parentComment: one(commentTable, {
    fields: [commentTable.parentCommentId],
    references: [commentTable.id],
    relationName: "commentReplies",
  }),
  replies: many(commentTable, {
    relationName: "commentReplies",
  }),
  commentReactions: many(commentReactionTable),
}));

export const commentReactionRelations = relations(
  commentReactionTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [commentReactionTable.userId],
      references: [userTable.id],
    }),
    comment: one(commentTable, {
      fields: [commentReactionTable.commentId],
      references: [commentTable.id],
    }),
  })
);

export const siteRelations = relations(siteTable, ({ one }) => ({
  organization: one(organizationTable, {
    fields: [siteTable.organizationId],
    references: [organizationTable.id],
  }),
}));

export const changelogRelations = relations(
  changelogTable,
  ({ many, one }) => ({
    organization: one(organizationTable, {
      fields: [changelogTable.organizationId],
      references: [organizationTable.id],
    }),
    creator: one(userTable, {
      fields: [changelogTable.creatorId],
      references: [userTable.id],
    }),
    creatorMember: one(memberTable, {
      fields: [changelogTable.creatorMemberId],
      references: [memberTable.id],
    }),
    changelogTags: many(changelogTagTable),
  })
);

export const changelogTagRelations = relations(
  changelogTagTable,
  ({ one }) => ({
    changelog: one(changelogTable, {
      fields: [changelogTagTable.changelogId],
      references: [changelogTable.id],
    }),
    tag: one(tagTable, {
      fields: [changelogTagTable.tagId],
      references: [tagTable.id],
    }),
    organization: one(organizationTable, {
      fields: [changelogTagTable.organizationId],
      references: [organizationTable.id],
    }),
  })
);

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
