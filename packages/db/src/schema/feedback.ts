import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
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
    foreignKey({
      name: "post_merged_into_same_organization_fk",
      columns: [table.mergedIntoPostId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
    }).onDelete("restrict"),
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
    hidePoweredBy: boolean("hide_powered_by").default(false).notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [uniqueIndex("site_organizationId_uidx").on(table.organizationId)]
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

export type InsertComment = typeof commentTable.$inferInsert;
