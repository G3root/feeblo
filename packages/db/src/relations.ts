import { defineRelations } from "drizzle-orm";

import {
  accountTable,
  assetTable,
  boardTable,
  changelogAssetTable,
  changelogCategoryLinkTable,
  changelogCategoryTable,
  changelogPostTable,
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
  emailContactTable,
  emailDeliveryTable,
  emailOutboxTable,
  emailProviderEventTable,
  emailSubscriptionTable,
  externalResourceCreateRequestTable,
  githubInstallationTable,
  githubSyncRuleTable,
  githubWebhookDeliveryTable,
  integrationConnectionTable,
  integrationDeliveryAttemptTable,
  integrationDeliveryTable,
  integrationEventTable,
  integrationExternalResourceTable,
  integrationRouteTable,
  invitationTable,
  jwtSecretTable,
  memberTable,
  organizationTable,
  postActivityTable,
  postAssetTable,
  postExternalResourceLinkTable,
  postReactionTable,
  postStatusTable,
  postSubscriptionTable,
  postTable,
  postTagTable,
  productTable,
  roadmapColumnTable,
  roadmapTable,
  sessionTable,
  siteTable,
  subscriptionTable,
  tagTable,
  twoFactorTable,
  upvoteTable,
  userTable,
} from "./schema";

export const relations = defineRelations(
  {
    userTable,
    assetTable,
    postAssetTable,
    changelogAssetTable,
    sessionTable,
    accountTable,
    twoFactorTable,
    jwtSecretTable,
    organizationTable,
    memberTable,
    invitationTable,
    integrationConnectionTable,
    githubInstallationTable,
    integrationRouteTable,
    integrationEventTable,
    integrationDeliveryTable,
    integrationDeliveryAttemptTable,
    integrationExternalResourceTable,
    postExternalResourceLinkTable,
    githubSyncRuleTable,
    githubWebhookDeliveryTable,
    externalResourceCreateRequestTable,
    subscriptionTable,
    productTable,
    boardTable,
    tagTable,
    postTable,
    postActivityTable,
    postTagTable,
    postStatusTable,
    upvoteTable,
    postReactionTable,
    roadmapTable,
    roadmapColumnTable,
    postSubscriptionTable,
    commentTable,
    commentReactionTable,
    siteTable,
    changelogCategoryLinkTable,
    changelogCategoryTable,
    changelogTable,
    changelogPostTable,
    changelogTagTable,
    companyTable,
    contactTable,
    companyAttributeDefinitionTable,
    companyAttributeValueTable,
    contactAttributeDefinitionTable,
    contactAttributeValueTable,
    emailOutboxTable,
    emailDeliveryTable,
    emailProviderEventTable,
    emailContactTable,
    emailSubscriptionTable,
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
      assets: r.many.assetTable({
        from: r.userTable.id,
        to: r.assetTable.userId,
      }),
    },
    assetTable: {
      user: r.one.userTable({
        from: r.assetTable.userId,
        to: r.userTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.assetTable.organizationId,
        to: r.organizationTable.id,
      }),
      posts: r.many.postAssetTable({
        from: r.assetTable.id,
        to: r.postAssetTable.assetId,
      }),
      changelogs: r.many.changelogAssetTable({
        from: r.assetTable.id,
        to: r.changelogAssetTable.assetId,
      }),
    },
    postAssetTable: {
      post: r.one.postTable({
        from: r.postAssetTable.postId,
        to: r.postTable.id,
      }),
      asset: r.one.assetTable({
        from: r.postAssetTable.assetId,
        to: r.assetTable.id,
      }),
    },
    changelogAssetTable: {
      changelog: r.one.changelogTable({
        from: r.changelogAssetTable.changelogId,
        to: r.changelogTable.id,
      }),
      asset: r.one.assetTable({
        from: r.changelogAssetTable.assetId,
        to: r.assetTable.id,
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
      roadmaps: r.many.roadmapTable({
        from: r.organizationTable.id,
        to: r.roadmapTable.organizationId,
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
      changelogCategories: r.many.changelogCategoryTable({
        from: r.organizationTable.id,
        to: r.changelogCategoryTable.organizationId,
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
      emailOutbox: r.many.emailOutboxTable({
        from: r.organizationTable.id,
        to: r.emailOutboxTable.organizationId,
      }),
      emailContacts: r.many.emailContactTable({
        from: r.organizationTable.id,
        to: r.emailContactTable.organizationId,
      }),
      emailSubscriptions: r.many.emailSubscriptionTable({
        from: r.organizationTable.id,
        to: r.emailSubscriptionTable.organizationId,
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
      assets: r.many.assetTable({
        from: r.organizationTable.id,
        to: r.assetTable.organizationId,
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
      activities: r.many.postActivityTable({
        from: r.postTable.id,
        to: r.postActivityTable.postId,
      }),
      postTags: r.many.postTagTable({
        from: r.postTable.id,
        to: r.postTagTable.postId,
      }),
      changelogPosts: r.many.changelogPostTable({
        from: r.postTable.id,
        to: r.changelogPostTable.postId,
      }),
      subscriptions: r.many.postSubscriptionTable({
        from: r.postTable.id,
        to: r.postSubscriptionTable.postId,
      }),
      assets: r.many.postAssetTable({
        from: r.postTable.id,
        to: r.postAssetTable.postId,
      }),
    },
    postActivityTable: {
      post: r.one.postTable({
        from: r.postActivityTable.postId,
        to: r.postTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.postActivityTable.organizationId,
        to: r.organizationTable.id,
      }),
      actor: r.one.userTable({
        from: r.postActivityTable.actorId,
        to: r.userTable.id,
      }),
      actorMember: r.one.memberTable({
        from: r.postActivityTable.actorMemberId,
        to: r.memberTable.id,
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
    emailOutboxTable: {
      organization: r.one.organizationTable({
        from: r.emailOutboxTable.organizationId,
        to: r.organizationTable.id,
      }),
      deliveries: r.many.emailDeliveryTable({
        from: r.emailOutboxTable.id,
        to: r.emailDeliveryTable.outboxId,
      }),
    },
    emailDeliveryTable: {
      outbox: r.one.emailOutboxTable({
        from: r.emailDeliveryTable.outboxId,
        to: r.emailOutboxTable.id,
      }),
      providerEvents: r.many.emailProviderEventTable({
        from: r.emailDeliveryTable.id,
        to: r.emailProviderEventTable.deliveryId,
      }),
    },
    emailProviderEventTable: {
      delivery: r.one.emailDeliveryTable({
        from: r.emailProviderEventTable.deliveryId,
        to: r.emailDeliveryTable.id,
      }),
    },
    emailContactTable: {
      organization: r.one.organizationTable({
        from: r.emailContactTable.organizationId,
        to: r.organizationTable.id,
      }),
      user: r.one.userTable({
        from: r.emailContactTable.userId,
        to: r.userTable.id,
      }),
      subscriptions: r.many.emailSubscriptionTable({
        from: r.emailContactTable.id,
        to: r.emailSubscriptionTable.contactId,
      }),
    },
    emailSubscriptionTable: {
      organization: r.one.organizationTable({
        from: r.emailSubscriptionTable.organizationId,
        to: r.organizationTable.id,
      }),
      contact: r.one.emailContactTable({
        from: r.emailSubscriptionTable.contactId,
        to: r.emailContactTable.id,
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
    roadmapTable: {
      organization: r.one.organizationTable({
        from: r.roadmapTable.organizationId,
        to: r.organizationTable.id,
      }),
      columns: r.many.roadmapColumnTable({
        from: r.roadmapTable.id,
        to: r.roadmapColumnTable.roadmapId,
      }),
    },
    roadmapColumnTable: {
      roadmap: r.one.roadmapTable({
        from: r.roadmapColumnTable.roadmapId,
        to: r.roadmapTable.id,
      }),
    },
    changelogCategoryTable: {
      organization: r.one.organizationTable({
        from: r.changelogCategoryTable.organizationId,
        to: r.organizationTable.id,
      }),
      changelogLinks: r.many.changelogCategoryLinkTable({
        from: r.changelogCategoryTable.id,
        to: r.changelogCategoryLinkTable.categoryId,
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
      changelogCategories: r.many.changelogCategoryLinkTable({
        from: r.changelogTable.id,
        to: r.changelogCategoryLinkTable.changelogId,
      }),
      changelogTags: r.many.changelogTagTable({
        from: r.changelogTable.id,
        to: r.changelogTagTable.changelogId,
      }),
      changelogPosts: r.many.changelogPostTable({
        from: r.changelogTable.id,
        to: r.changelogPostTable.changelogId,
      }),
      assets: r.many.changelogAssetTable({
        from: r.changelogTable.id,
        to: r.changelogAssetTable.changelogId,
      }),
    },
    changelogCategoryLinkTable: {
      changelog: r.one.changelogTable({
        from: r.changelogCategoryLinkTable.changelogId,
        to: r.changelogTable.id,
      }),
      category: r.one.changelogCategoryTable({
        from: r.changelogCategoryLinkTable.categoryId,
        to: r.changelogCategoryTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.changelogCategoryLinkTable.organizationId,
        to: r.organizationTable.id,
      }),
    },
    changelogPostTable: {
      changelog: r.one.changelogTable({
        from: r.changelogPostTable.changelogId,
        to: r.changelogTable.id,
      }),
      post: r.one.postTable({
        from: r.changelogPostTable.postId,
        to: r.postTable.id,
      }),
      organization: r.one.organizationTable({
        from: r.changelogPostTable.organizationId,
        to: r.organizationTable.id,
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
    integrationConnectionTable: {
      organization: r.one.organizationTable({
        from: r.integrationConnectionTable.organizationId,
        to: r.organizationTable.id,
      }),
      routes: r.many.integrationRouteTable({
        from: r.integrationConnectionTable.id,
        to: r.integrationRouteTable.connectionId,
      }),
      deliveries: r.many.integrationDeliveryTable({
        from: r.integrationConnectionTable.id,
        to: r.integrationDeliveryTable.connectionId,
      }),
      githubInstallation: r.one.githubInstallationTable({
        from: r.integrationConnectionTable.id,
        to: r.githubInstallationTable.connectionId,
      }),
    },
    githubInstallationTable: {
      connection: r.one.integrationConnectionTable({
        from: r.githubInstallationTable.connectionId,
        to: r.integrationConnectionTable.id,
      }),
    },
    integrationRouteTable: {
      organization: r.one.organizationTable({
        from: r.integrationRouteTable.organizationId,
        to: r.organizationTable.id,
      }),
      connection: r.one.integrationConnectionTable({
        from: r.integrationRouteTable.connectionId,
        to: r.integrationConnectionTable.id,
      }),
      deliveries: r.many.integrationDeliveryTable({
        from: r.integrationRouteTable.id,
        to: r.integrationDeliveryTable.routeId,
      }),
    },
    integrationEventTable: {
      organization: r.one.organizationTable({
        from: r.integrationEventTable.organizationId,
        to: r.organizationTable.id,
      }),
      deliveries: r.many.integrationDeliveryTable({
        from: r.integrationEventTable.id,
        to: r.integrationDeliveryTable.eventId,
      }),
    },
    integrationDeliveryTable: {
      organization: r.one.organizationTable({
        from: r.integrationDeliveryTable.organizationId,
        to: r.organizationTable.id,
      }),
      connection: r.one.integrationConnectionTable({
        from: r.integrationDeliveryTable.connectionId,
        to: r.integrationConnectionTable.id,
      }),
      route: r.one.integrationRouteTable({
        from: r.integrationDeliveryTable.routeId,
        to: r.integrationRouteTable.id,
      }),
      event: r.one.integrationEventTable({
        from: r.integrationDeliveryTable.eventId,
        to: r.integrationEventTable.id,
      }),
      attempts: r.many.integrationDeliveryAttemptTable({
        from: r.integrationDeliveryTable.id,
        to: r.integrationDeliveryAttemptTable.deliveryId,
      }),
    },
    integrationDeliveryAttemptTable: {
      delivery: r.one.integrationDeliveryTable({
        from: r.integrationDeliveryAttemptTable.deliveryId,
        to: r.integrationDeliveryTable.id,
      }),
    },
    integrationExternalResourceTable: {
      connection: r.one.integrationConnectionTable({
        from: r.integrationExternalResourceTable.connectionId,
        to: r.integrationConnectionTable.id,
      }),
      links: r.many.postExternalResourceLinkTable({
        from: r.integrationExternalResourceTable.id,
        to: r.postExternalResourceLinkTable.externalResourceId,
      }),
    },
    postExternalResourceLinkTable: {
      post: r.one.postTable({
        from: r.postExternalResourceLinkTable.postId,
        to: r.postTable.id,
      }),
      externalResource: r.one.integrationExternalResourceTable({
        from: r.postExternalResourceLinkTable.externalResourceId,
        to: r.integrationExternalResourceTable.id,
      }),
    },
    githubSyncRuleTable: {
      connection: r.one.integrationConnectionTable({
        from: r.githubSyncRuleTable.connectionId,
        to: r.integrationConnectionTable.id,
      }),
      postStatus: r.one.postStatusTable({
        from: r.githubSyncRuleTable.postStatusId,
        to: r.postStatusTable.id,
      }),
    },
    githubWebhookDeliveryTable: {
      connection: r.one.integrationConnectionTable({
        from: r.githubWebhookDeliveryTable.connectionId,
        to: r.integrationConnectionTable.id,
      }),
    },
  })
);
