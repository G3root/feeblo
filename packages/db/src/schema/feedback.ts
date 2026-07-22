import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { memberTable, organizationTable, userTable } from "./auth";

export const boardVisibilityEnum = pgEnum("board_visibility", [
  "PUBLIC",
  "PRIVATE",
]);

export const postStatusEnum = pgEnum("post_status_types", [
  "PENDING",
  "REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
]);

export type TPostStatus = (typeof postStatusEnum.enumValues)[number];

export const POST_STATUS_TYPES = postStatusEnum.enumValues;

export const DEFAULT_POST_STATUSES = [
  { orderIndex: 0, type: "PENDING" },
  { orderIndex: 1, type: "REVIEW" },
  { orderIndex: 2, type: "PLANNED" },
  { orderIndex: 3, type: "IN_PROGRESS" },
  { orderIndex: 4, type: "COMPLETED" },
  { orderIndex: 5, type: "CLOSED" },
] as const satisfies ReadonlyArray<{
  orderIndex: number;
  type: TPostStatus;
}>;

export const changelogStatusEnum = pgEnum("changelog_status", [
  "draft",
  "scheduled",
  "published",
]);

export const changelogVisibilityEnum = pgEnum("changelog_visibility", [
  "PUBLIC",
  "HIDDEN",
]);

export const roadmapVisibilityEnum = pgEnum("roadmap_visibility", [
  "PUBLIC",
  "HIDDEN",
]);

export const postIconTypeEnum = pgEnum("post_icon_type", ["EMOJI"]);

export const postCommentVisibilityEnum = pgEnum("post_comment_visibility", [
  "PUBLIC",
  "INTERNAL",
]);

export const tagTypeEnum = pgEnum("tag_type", ["FEEDBACK", "CHANGELOG"]);

export const postSourceEnum = pgEnum("post_source", [
  "DASHBOARD",
  "WIDGET",
  "API",
  "IMPORT",
  "PUBLIC_BOARD",
]);

export const contactCompanySourceEnum = pgEnum("contact_company_source", [
  "DASHBOARD",
  "WIDGET",
  "API",
  "IMPORT",
]);

export const attributeDataTypeEnum = pgEnum("attribute_data_type", [
  "TEXT",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
]);

export const boardTable = pgTable(
  "board",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    visibility: boardVisibilityEnum("visibility").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    creatorId: text("creator_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    creatorMemberId: text("creator_member_id").references(
      () => memberTable.id,
      {
        onDelete: "set null",
      }
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    uniqueIndex("board_organizationId_slug_uidx").on(
      table.organizationId,
      table.slug
    ),
  ]
);

export const tagTable = pgTable(
  "tag",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: tagTypeEnum("type").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    creatorId: text("creator_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    creatorMemberId: text("creator_member_id").references(
      () => memberTable.id,
      {
        onDelete: "set null",
      }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("tag_organizationId_type_name_uidx").on(
      table.organizationId,
      table.type,
      table.name
    ),
    uniqueIndex("tag_organizationId_type_slug_uidx").on(
      table.organizationId,
      table.type,
      table.slug
    ),
  ]
);

export const postStatusTable = pgTable(
  "post_status",
  {
    id: text("id").primaryKey(),
    type: postStatusEnum("type").notNull(),
    orderIndex: integer("order_index").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("post_status_organizationId_idx").on(table.organizationId),
    uniqueIndex("post_status_organizationId_type_uidx").on(
      table.organizationId,
      table.type
    ),
    uniqueIndex("post_status_organizationId_orderIndex_uidx").on(
      table.organizationId,
      table.orderIndex
    ),
  ]
);

export const postTagTable = pgTable(
  "post_tag",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tagTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("post_tag_postId_idx").on(table.postId),
    index("post_tag_tagId_idx").on(table.tagId),
    uniqueIndex("post_tag_postId_tagId_uidx").on(table.postId, table.tagId),
  ]
);

export const changelogTagTable = pgTable(
  "changelog_tag",
  {
    id: text("id").primaryKey(),
    changelogId: text("changelog_id")
      .notNull()
      .references(() => changelogTable.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tagTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("changelog_tag_changelogId_idx").on(table.changelogId),
    index("changelog_tag_tagId_idx").on(table.tagId),
    uniqueIndex("changelog_tag_changelogId_tagId_uidx").on(
      table.changelogId,
      table.tagId
    ),
  ]
);

export const companyTable = pgTable(
  "company",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    externalId: text("external_id"),
    avatar: text("avatar"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    externalCreatedAt: timestamp("external_created_at", { withTimezone: true }),
    source: contactCompanySourceEnum("source").default("DASHBOARD").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("company_organizationId_idx").on(table.organizationId),
    uniqueIndex("company_organizationId_externalId_uidx").on(
      table.organizationId,
      table.externalId
    ),
    uniqueIndex("company_organizationId_name_uidx").on(
      table.organizationId,
      table.name
    ),
  ]
);

export const contactTable = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    externalId: text("external_id"),
    avatar: text("avatar"),
    companyId: text("company_id").references(() => companyTable.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    source: contactCompanySourceEnum("source").default("DASHBOARD").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("contact_organizationId_idx").on(table.organizationId),
    index("contact_companyId_idx").on(table.companyId),
    index("contact_userId_idx").on(table.userId),
    uniqueIndex("contact_organizationId_externalId_uidx").on(
      table.organizationId,
      table.externalId
    ),
    uniqueIndex("contact_organizationId_email_uidx").on(
      table.organizationId,
      table.email
    ),
  ]
);

export const postTable = pgTable(
  "post",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    content: text("content").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    boardId: text("board_id")
      .notNull()
      .references(() => boardTable.id, { onDelete: "cascade" }),
    statusId: text("status_schema_id")
      .notNull()
      .references(() => postStatusTable.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    creatorId: text("creator_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    creatorMemberId: text("creator_member_id").references(
      () => memberTable.id,
      {
        onDelete: "set null",
      }
    ),
    contactId: text("contact_id").references(() => contactTable.id, {
      onDelete: "set null",
    }),
    source: postSourceEnum("source").default("DASHBOARD").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    mergedIntoPostId: text("merged_into_post_id"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    index("post_statusId_idx").on(table.statusId),
    index("post_archivedAt_idx").on(table.archivedAt),
    index("post_mergedIntoPostId_idx").on(table.mergedIntoPostId),
    uniqueIndex("post_id_organizationId_uidx").on(
      table.id,
      table.organizationId
    ),
    uniqueIndex("post_organizationId_boardId_slug_uidx").on(
      table.organizationId,
      table.boardId,
      table.slug
    ),
    check(
      "post_merge_requires_target_and_timestamp_chk",
      sql`(${table.mergedIntoPostId} is null and ${table.mergedAt} is null) or (${table.mergedIntoPostId} is not null and ${table.mergedAt} is not null)`
    ),
    check(
      "post_merged_rows_must_be_archived_chk",
      sql`${table.mergedIntoPostId} is null or ${table.archivedAt} is not null`
    ),
    check(
      "post_no_self_merge_chk",
      sql`${table.mergedIntoPostId} is null or ${table.mergedIntoPostId} <> ${table.id}`
    ),
    foreignKey({
      name: "post_merged_into_same_organization_fk",
      columns: [table.mergedIntoPostId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
    }).onDelete("restrict"),
  ]
);

export const upvoteTable = pgTable(
  "upvote",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => memberTable.id, {
      onDelete: "set null",
    }),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("upvote_postId_idx").on(table.postId),
    uniqueIndex("upvote_userId_postId_uidx").on(table.userId, table.postId),
  ]
);

export const postReactionTable = pgTable(
  "post_reaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => memberTable.id, {
      onDelete: "set null",
    }),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("postReaction_userId_postId_emoji_uidx").on(
      table.userId,
      table.postId,
      table.emoji
    ),
  ]
);

export const postSubscriptionTable = pgTable(
  "post_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => memberTable.id, {
      onDelete: "set null",
    }),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("post_subscription_postId_idx").on(table.postId),
    index("post_subscription_userId_idx").on(table.userId),
    uniqueIndex("post_subscription_postId_userId_uidx").on(
      table.postId,
      table.userId
    ),
  ]
);

export const commentTable = pgTable("comment", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationTable.id, { onDelete: "cascade" }),
  postId: text("post_id")
    .notNull()
    .references(() => postTable.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  memberId: text("member_id").references(() => memberTable.id, {
    onDelete: "set null",
  }),
  visibility: postCommentVisibilityEnum("visibility")
    .default("PUBLIC")
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  parentCommentId: text("parent_comment_id").references(
    (): AnyPgColumn => commentTable.id,
    {
      onDelete: "cascade",
    }
  ),
});

export const commentReactionTable = pgTable(
  "comment_reaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => memberTable.id, {
      onDelete: "set null",
    }),
    commentId: text("comment_id")
      .notNull()
      .references(() => commentTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("commentReaction_userId_commentId_emoji_uidx").on(
      table.userId,
      table.commentId,
      table.emoji
    ),
  ]
);

export const siteTable = pgTable(
  "site",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    subdomain: text("subdomain").notNull(),
    customDomain: text("custom_domain"),
    changelogVisibility: changelogVisibilityEnum("changelog_visibility")
      .default("PUBLIC")
      .notNull(),
    roadmapVisibility: roadmapVisibilityEnum("roadmap_visibility")
      .default("PUBLIC")
      .notNull(),
    noIndex: boolean("no_index").default(false).notNull(),
    hidePoweredBy: boolean("hide_powered_by").default(false).notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    uniqueIndex("site_organizationId_uidx").on(table.organizationId),
    uniqueIndex("site_subdomain_uidx").on(table.subdomain),
  ]
);

export const changelogTable = pgTable(
  "changelog",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    content: text("content").notNull(),
    status: changelogStatusEnum("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    creatorId: text("creator_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    creatorMemberId: text("creator_member_id").references(
      () => memberTable.id,
      {
        onDelete: "set null",
      }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("changelog_organizationId_slug_uidx").on(
      table.organizationId,
      table.slug
    ),
  ]
);

export const contactAttributeDefinitionTable = pgTable(
  "contact_attribute_definition",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    description: text("description"),
    type: attributeDataTypeEnum("type").notNull(),
    config: jsonb("config").$type<{
      min?: number;
      max?: number;
      pattern?: string;
    }>(),
    isRequired: boolean("is_required").default(false).notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("contact_attribute_definition_organizationId_idx").on(
      table.organizationId
    ),
    uniqueIndex("contact_attribute_definition_organizationId_key_uidx").on(
      table.organizationId,
      table.key
    ),
  ]
);

export const contactAttributeValueTable = pgTable(
  "contact_attribute_value",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contactTable.id, { onDelete: "cascade" }),
    attributeId: text("attribute_id")
      .notNull()
      .references(() => contactAttributeDefinitionTable.id, {
        onDelete: "cascade",
      }),
    valueText: text("value_text"),
    valueInteger: integer("value_integer"),
    valueDecimal: real("value_decimal"),
    valueBoolean: boolean("value_boolean"),
    valueDate: timestamp("value_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("contact_attribute_value_organizationId_idx").on(
      table.organizationId
    ),
    index("contact_attribute_value_contactId_idx").on(table.contactId),
    index("contact_attribute_value_attributeId_idx").on(table.attributeId),
    uniqueIndex("contact_attribute_value_contactId_attributeId_uidx").on(
      table.contactId,
      table.attributeId
    ),
  ]
);

export const companyAttributeDefinitionTable = pgTable(
  "company_attribute_definition",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    description: text("description"),
    type: attributeDataTypeEnum("type").notNull(),
    config: jsonb("config").$type<{
      min?: number;
      max?: number;
      pattern?: string;
    }>(),
    isRequired: boolean("is_required").default(false).notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("company_attribute_definition_organizationId_idx").on(
      table.organizationId
    ),
    uniqueIndex("company_attribute_definition_organizationId_key_uidx").on(
      table.organizationId,
      table.key
    ),
  ]
);

export const companyAttributeValueTable = pgTable(
  "company_attribute_value",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companyTable.id, { onDelete: "cascade" }),
    attributeId: text("attribute_id")
      .notNull()
      .references(() => companyAttributeDefinitionTable.id, {
        onDelete: "cascade",
      }),
    valueText: text("value_text"),
    valueInteger: integer("value_integer"),
    valueDecimal: real("value_decimal"),
    valueBoolean: boolean("value_boolean"),
    valueDate: timestamp("value_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("company_attribute_value_organizationId_idx").on(
      table.organizationId
    ),
    index("company_attribute_value_companyId_idx").on(table.companyId),
    index("company_attribute_value_attributeId_idx").on(table.attributeId),
    uniqueIndex("company_attribute_value_companyId_attributeId_uidx").on(
      table.companyId,
      table.attributeId
    ),
  ]
);

export const submissionNotificationQueueTable = pgTable(
  "submission_notification_queue",
  {
    postId: text("post_id")
      .primaryKey()
      .references(() => postTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("submission_notification_queue_organization_idx").on(
      table.organizationId
    ),
  ]
);

export const submissionNotificationBatchTable = pgTable(
  "submission_notification_batch",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" })
      .unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export type InsertComment = typeof commentTable.$inferInsert;
export type PostSubscription = typeof postSubscriptionTable.$inferSelect;
export type NewPostSubscription = typeof postSubscriptionTable.$inferInsert;
