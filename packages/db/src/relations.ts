import { defineRelations } from "drizzle-orm";
import {
  accountTable,
  boardTable,
  changelogTable,
  changelogTagTable,
  commentReactionTable,
  commentTable,
  companyAttributeDefinitionTable,
  companyAttributeValueTable,
  companyTable,
  contactAttributeDefinitionTable,
  contactAttributeValueTable,
  contactTable,
  invitationTable,
  jwtSecretTable,
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
  submissionNotificationBatchTable,
  submissionNotificationQueueTable,
  subscriptionTable,
  tagTable,
  twoFactorTable,
  upvoteTable,
  userTable,
} from "./schema";

export const relations = defineRelations(
  {
    userTable,
    sessionTable,
    accountTable,
    twoFactorTable,
    jwtSecretTable,
    organizationTable,
    memberTable,
    invitationTable,
    subscriptionTable,
    productTable,
    boardTable,
    tagTable,
    postTable,
    postTagTable,
    postStatusTable,
    upvoteTable,
    postReactionTable,
    postSubscriptionTable,
    commentTable,
    commentReactionTable,
    siteTable,
    changelogTable,
    changelogTagTable,
    companyTable,
    contactTable,
    companyAttributeDefinitionTable,
    companyAttributeValueTable,
    contactAttributeDefinitionTable,
    contactAttributeValueTable,
    submissionNotificationBatchTable,
    submissionNotificationQueueTable,
  },
  (r) => ({
    userTable: {
      sessions: r.many.sessionTable({
        from: r.userTable.id,
        to: r.sessionTable.userId,
      }),
      accounts: r.many.accountTable({
        from: r.userTable.id,
        to: r.accountTable.userId,
      }),
      twoFactors: r.many.twoFactorTable({
        from: r.userTable.id,
        to: r.twoFactorTable.userId,
      }),
      members: r.many.memberTable({
        from: r.userTable.id,
        to: r.memberTable.userId,
      }),
      invitations: r.many.invitationTable({
        from: r.userTable.id,
        to: r.invitationTable.inviterId,
      }),
      upvotes: r.many.upvoteTable({
        from: r.userTable.id,
        to: r.upvoteTable.userId,
      }),
      postReactions: r.many.postReactionTable({
        from: r.userTable.id,
        to: r.postReactionTable.userId,
      }),
      comments: r.many.commentTable({
        from: r.userTable.id,
        to: r.commentTable.userId,
      }),
      commentReactions: r.many.commentReactionTable({
        from: r.userTable.id,
        to: r.commentReactionTable.userId,
      }),
      createdPosts: r.many.postTable({
        from: r.userTable.id,
        to: r.postTable.creatorId,
      }),
      createdChangelogs: r.many.changelogTable({
        from: r.userTable.id,
        to: r.changelogTable.creatorId,
      }),
      createdTags: r.many.tagTable({
        from: r.userTable.id,
        to: r.tagTable.creatorId,
      }),
      postSubscriptions: r.many.postSubscriptionTable({
        from: r.userTable.id,
        to: r.postSubscriptionTable.userId,
      }),
    },
    sessionTable: {
      user: r.one.userTable({
        from: r.sessionTable.userId,
        to: r.userTable.id,
      }),
    },
    accountTable: {
      user: r.one.userTable({
        from: r.accountTable.userId,
        to: r.userTable.id,
      }),
    },
    twoFactorTable: {
      user: r.one.userTable({
        from: r.twoFactorTable.userId,
        to: r.userTable.id,
      }),
    },
    jwtSecretTable: {
      organization: r.one.organizationTable({
        from: r.jwtSecretTable.organizationId,
        to: r.organizationTable.id,
      }),
    },
    organizationTable: {
      jwtSecrets: r.many.jwtSecretTable({
        from: r.organizationTable.id,
        to: r.jwtSecretTable.organizationId,
      }),
      members: r.many.memberTable({
        from: r.organizationTable.id,
        to: r.memberTable.organizationId,
      }),
      invitations: r.many.invitationTable({
        from: r.organizationTable.id,
        to: r.invitationTable.organizationId,
      }),
      boards: r.many.boardTable({
        from: r.organizationTable.id,
        to: r.boardTable.organizationId,
      }),
      tags: r.many.tagTable({
        from: r.organizationTable.id,
        to: r.tagTable.organizationId,
      }),
      postStatuses: r.many.postStatusTable({
        from: r.organizationTable.id,
        to: r.postStatusTable.organizationId,
      }),
      posts: r.many.postTable({
        from: r.organizationTable.id,
        to: r.postTable.organizationId,
      }),
      postTags: r.many.postTagTable({
        from: r.organizationTable.id,
        to: r.postTagTable.organizationId,
      }),
      comments: r.many.commentTable({
        from: r.organizationTable.id,
        to: r.commentTable.organizationId,
      }),
      changelogs: r.many.changelogTable({
        from: r.organizationTable.id,
        to: r.changelogTable.organizationId,
      }),
      changelogTags: r.many.changelogTagTable({
        from: r.organizationTable.id,
        to: r.changelogTagTable.organizationId,
      }),
      companies: r.many.companyTable({
        from: r.organizationTable.id,
        to: r.companyTable.organizationId,
      }),
      contacts: r.many.contactTable({
        from: r.organizationTable.id,
        to: r.contactTable.organizationId,
      }),
      contactAttributeDefinitions: r.many.contactAttributeDefinitionTable({
        from: r.organizationTable.id,
        to: r.contactAttributeDefinitionTable.organizationId,
      }),
      companyAttributeDefinitions: r.many.companyAttributeDefinitionTable({
        from: r.organizationTable.id,
        to: r.companyAttributeDefinitionTable.organizationId,
      }),
      companyAttributeValues: r.many.companyAttributeValueTable({
        from: r.organizationTable.id,
        to: r.companyAttributeValueTable.organizationId,
      }),
      contactAttributeValues: r.many.contactAttributeValueTable({
        from: r.organizationTable.id,
        to: r.contactAttributeValueTable.organizationId,
      }),
      site: r.one.siteTable({
        from: r.organizationTable.id,
        to: r.siteTable.organizationId,
      }),
      subscriptions: r.many.subscriptionTable({
        from: r.organizationTable.id,
        to: r.subscriptionTable.organizationId,
      }),
      submissionNotificationBatch: r.one.submissionNotificationBatchTable({
        from: r.organizationTable.id,
        to: r.submissionNotificationBatchTable.organizationId,
      }),
      submissionNotificationQueue: r.many.submissionNotificationQueueTable({
        from: r.organizationTable.id,
        to: r.submissionNotificationQueueTable.organizationId,
      }),
    },
    memberTable: {
      organization: r.one.organizationTable({
        from: r.memberTable.organizationId,
        to: r.organizationTable.id,
      }),
      user: r.one.userTable({
        from: r.memberTable.userId,
        to: r.userTable.id,
      }),
    },
    invitationTable: {
      organization: r.one.organizationTable({
        from: r.invitationTable.organizationId,
        to: r.organizationTable.id,
      }),
      user: r.one.userTable({
        from: r.invitationTable.inviterId,
        to: r.userTable.id,
      }),
    },
    boardTable: {
      organization: r.one.organizationTable({
        from: r.boardTable.organizationId,
        to: r.organizationTable.id,
      }),
      posts: r.many.postTable({
        from: r.boardTable.id,
        to: r.postTable.boardId,
      }),
    },
    tagTable: {
      organization: r.one.organizationTable({
        from: r.tagTable.organizationId,
        to: r.organizationTable.id,
      }),
      creator: r.one.userTable({
        from: r.tagTable.creatorId,
        to: r.userTable.id,
      }),
      creatorMember: r.one.memberTable({
        from: r.tagTable.creatorMemberId,
        to: r.memberTable.id,
      }),
      postTags: r.many.postTagTable({
        from: r.tagTable.id,
        to: r.postTagTable.tagId,
      }),
      changelogTags: r.many.changelogTagTable({
        from: r.tagTable.id,
        to: r.changelogTagTable.tagId,
      }),
    },
    postTagTable: {
      post: r.one.postTable({
        from: r.postTagTable.postId,
        to: r.postTable.id,
      }),
      tag: r.one.tagTable({
        from: r.postTagTable.tagId,
        to: r.tagTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.postTagTable.organizationId,
        to: r.organizationTable.id,
      }),
    },
    postStatusTable: {
      organization: r.one.organizationTable({
        from: r.postStatusTable.organizationId,
        to: r.organizationTable.id,
      }),
      posts: r.many.postTable({
        from: r.postStatusTable.id,
        to: r.postTable.statusId,
      }),
    },
    postTable: {
      board: r.one.boardTable({
        from: r.postTable.boardId,
        to: r.boardTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.postTable.organizationId,
        to: r.organizationTable.id,
      }),
      postStatus: r.one.postStatusTable({
        from: r.postTable.statusId,
        to: r.postStatusTable.id,
      }),
      creator: r.one.userTable({
        from: r.postTable.creatorId,
        to: r.userTable.id,
      }),
      creatorMember: r.one.memberTable({
        from: r.postTable.creatorMemberId,
        to: r.memberTable.id,
      }),
      contact: r.one.contactTable({
        from: r.postTable.contactId,
        to: r.contactTable.id,
      }),
      upvotes: r.many.upvoteTable({
        from: r.postTable.id,
        to: r.upvoteTable.postId,
      }),
      postReactions: r.many.postReactionTable({
        from: r.postTable.id,
        to: r.postReactionTable.postId,
      }),
      comments: r.many.commentTable({
        from: r.postTable.id,
        to: r.commentTable.postId,
      }),
      postTags: r.many.postTagTable({
        from: r.postTable.id,
        to: r.postTagTable.postId,
      }),
      subscriptions: r.many.postSubscriptionTable({
        from: r.postTable.id,
        to: r.postSubscriptionTable.postId,
      }),
      submissionNotification: r.one.submissionNotificationQueueTable({
        from: r.postTable.id,
        to: r.submissionNotificationQueueTable.postId,
      }),
    },
    postSubscriptionTable: {
      post: r.one.postTable({
        from: r.postSubscriptionTable.postId,
        to: r.postTable.id,
      }),
      user: r.one.userTable({
        from: r.postSubscriptionTable.userId,
        to: r.userTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.postSubscriptionTable.organizationId,
        to: r.organizationTable.id,
      }),
    },
    upvoteTable: {
      user: r.one.userTable({
        from: r.upvoteTable.userId,
        to: r.userTable.id,
      }),
      post: r.one.postTable({
        from: r.upvoteTable.postId,
        to: r.postTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.upvoteTable.organizationId,
        to: r.organizationTable.id,
      }),
    },
    postReactionTable: {
      user: r.one.userTable({
        from: r.postReactionTable.userId,
        to: r.userTable.id,
      }),
      post: r.one.postTable({
        from: r.postReactionTable.postId,
        to: r.postTable.id,
      }),
    },
    commentTable: {
      organization: r.one.organizationTable({
        from: r.commentTable.organizationId,
        to: r.organizationTable.id,
      }),
      post: r.one.postTable({
        from: r.commentTable.postId,
        to: r.postTable.id,
      }),
      user: r.one.userTable({
        from: r.commentTable.userId,
        to: r.userTable.id,
      }),
      parentComment: r.one.commentTable({
        from: r.commentTable.parentCommentId,
        to: r.commentTable.id,
        alias: "commentReplies",
      }),
      replies: r.many.commentTable({
        alias: "commentReplies",
      }),
      commentReactions: r.many.commentReactionTable({
        from: r.commentTable.id,
        to: r.commentReactionTable.commentId,
      }),
    },
    commentReactionTable: {
      user: r.one.userTable({
        from: r.commentReactionTable.userId,
        to: r.userTable.id,
      }),
      comment: r.one.commentTable({
        from: r.commentReactionTable.commentId,
        to: r.commentTable.id,
      }),
    },
    companyTable: {
      organization: r.one.organizationTable({
        from: r.companyTable.organizationId,
        to: r.organizationTable.id,
      }),
      contacts: r.many.contactTable({
        from: r.companyTable.id,
        to: r.contactTable.companyId,
      }),
      attributeValues: r.many.companyAttributeValueTable({
        from: r.companyTable.id,
        to: r.companyAttributeValueTable.companyId,
      }),
    },
    contactTable: {
      organization: r.one.organizationTable({
        from: r.contactTable.organizationId,
        to: r.organizationTable.id,
      }),
      company: r.one.companyTable({
        from: r.contactTable.companyId,
        to: r.companyTable.id,
      }),
      posts: r.many.postTable({
        from: r.contactTable.id,
        to: r.postTable.contactId,
      }),
      attributeValues: r.many.contactAttributeValueTable({
        from: r.contactTable.id,
        to: r.contactAttributeValueTable.contactId,
      }),
    },
    contactAttributeDefinitionTable: {
      organization: r.one.organizationTable({
        from: r.contactAttributeDefinitionTable.organizationId,
        to: r.organizationTable.id,
      }),
      values: r.many.contactAttributeValueTable({
        from: r.contactAttributeDefinitionTable.id,
        to: r.contactAttributeValueTable.attributeId,
      }),
    },
    contactAttributeValueTable: {
      organization: r.one.organizationTable({
        from: r.contactAttributeValueTable.organizationId,
        to: r.organizationTable.id,
      }),
      contact: r.one.contactTable({
        from: r.contactAttributeValueTable.contactId,
        to: r.contactTable.id,
      }),
      attribute: r.one.contactAttributeDefinitionTable({
        from: r.contactAttributeValueTable.attributeId,
        to: r.contactAttributeDefinitionTable.id,
      }),
    },
    companyAttributeDefinitionTable: {
      organization: r.one.organizationTable({
        from: r.companyAttributeDefinitionTable.organizationId,
        to: r.organizationTable.id,
      }),
      values: r.many.companyAttributeValueTable({
        from: r.companyAttributeDefinitionTable.id,
        to: r.companyAttributeValueTable.attributeId,
      }),
    },
    companyAttributeValueTable: {
      organization: r.one.organizationTable({
        from: r.companyAttributeValueTable.organizationId,
        to: r.organizationTable.id,
      }),
      company: r.one.companyTable({
        from: r.companyAttributeValueTable.companyId,
        to: r.companyTable.id,
      }),
      attribute: r.one.companyAttributeDefinitionTable({
        from: r.companyAttributeValueTable.attributeId,
        to: r.companyAttributeDefinitionTable.id,
      }),
    },
    siteTable: {
      organization: r.one.organizationTable({
        from: r.siteTable.organizationId,
        to: r.organizationTable.id,
      }),
    },
    changelogTable: {
      organization: r.one.organizationTable({
        from: r.changelogTable.organizationId,
        to: r.organizationTable.id,
      }),
      creator: r.one.userTable({
        from: r.changelogTable.creatorId,
        to: r.userTable.id,
      }),
      creatorMember: r.one.memberTable({
        from: r.changelogTable.creatorMemberId,
        to: r.memberTable.id,
      }),
      changelogTags: r.many.changelogTagTable({
        from: r.changelogTable.id,
        to: r.changelogTagTable.changelogId,
      }),
    },
    submissionNotificationBatchTable: {
      organization: r.one.organizationTable({
        from: r.submissionNotificationBatchTable.organizationId,
        to: r.organizationTable.id,
      }),
    },
    submissionNotificationQueueTable: {
      organization: r.one.organizationTable({
        from: r.submissionNotificationQueueTable.organizationId,
        to: r.organizationTable.id,
      }),
      post: r.one.postTable({
        from: r.submissionNotificationQueueTable.postId,
        to: r.postTable.id,
      }),
    },
    changelogTagTable: {
      changelog: r.one.changelogTable({
        from: r.changelogTagTable.changelogId,
        to: r.changelogTable.id,
      }),
      tag: r.one.tagTable({
        from: r.changelogTagTable.tagId,
        to: r.tagTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.changelogTagTable.organizationId,
        to: r.organizationTable.id,
      }),
    },
    subscriptionTable: {
      organization: r.one.organizationTable({
        from: r.subscriptionTable.organizationId,
        to: r.organizationTable.id,
      }),
      product: r.one.productTable({
        from: r.subscriptionTable.productId,
        to: r.productTable.id,
      }),
    },
    productTable: {
      subscriptions: r.many.subscriptionTable({
        from: r.productTable.id,
        to: r.subscriptionTable.productId,
      }),
    },
  })
);
