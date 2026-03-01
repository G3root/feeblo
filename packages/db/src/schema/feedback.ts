import {
  type AnyPgColumn,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { member, organization, user } from "./auth";

export const boardVisibilityEnum = pgEnum("board_visibility", [
  "PUBLIC",
  "PRIVATE",
]);

export const postStatusEnum = pgEnum("post_status", [
  "PAUSED",
  "REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
]);

export type TPostStatus = (typeof postStatusEnum.enumValues)[number];

export const postIconTypeEnum = pgEnum("post_icon_type", ["EMOJI"]);

export const postCommentVisibilityEnum = pgEnum("post_comment_visibility", [
  "PUBLIC",
  "INTERNAL",
]);

export const board = pgTable(
  "board",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    visibility: boardVisibilityEnum("visibility").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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

export const post = pgTable("post", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  publicId: text("public_id").notNull().unique(),
  slug: text("slug").notNull(),
  content: text("content").notNull(),
  boardId: text("board_id")
    .notNull()
    .references(() => board.id, { onDelete: "cascade" }),
  status: postStatusEnum("status").notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").references(() => user.id, {
    onDelete: "set null",
  }),
  creatorMemberId: text("creator_member_id").references(() => member.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$onUpdate(() => /* @__PURE__ */ new Date()),
});

export const upvote = pgTable(
  "upvote",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

export const postReaction = pgTable(
  "postReaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

export const comment = pgTable("comment", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  postId: text("post_id")
    .notNull()
    .references(() => post.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  memberId: text("member_id").references(() => member.id, {
    onDelete: "set null",
  }),
  visibility: postCommentVisibilityEnum("visibility")
    .default("PUBLIC")
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  parentCommentId: text("parent_comment_id").references(
    (): AnyPgColumn => comment.id,
    {
      onDelete: "cascade",
    }
  ),
});

export const commentReaction = pgTable(
  "commentReaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    commentId: text("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

export const site = pgTable(
  "site",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    subdomain: text("subdomain").notNull(),
    customDomain: text("custom_domain"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [uniqueIndex("site_organizationId_uidx").on(table.organizationId)]
);

export type InsertComment = typeof comment.$inferInsert;
