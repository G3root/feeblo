import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import * as Schema from "effect/Schema";

import type { TPostActivityKind } from "../validation-schema/activity-kind";
import type { TAttributeType } from "../validation-schema/attribute-type";
import type { TChangelogCategoryIconType } from "../validation-schema/changelog-category-icon-type";
import type {
  TEmailContactVerificationState,
  TEmailDeliveryState,
  TEmailIntentKind,
  TEmailOutboxState,
  TEmailProviderEventType,
  TEmailSubscriptionSource,
  TEmailSubscriptionState,
  TEmailSubscriptionTopicType,
  TEmailSuppressionReason,
} from "../validation-schema/email";
import type { TEntitySource } from "../validation-schema/entity-source";
import type { TNotificationEventType } from "../validation-schema/notification-kind";
import type { TPostSource } from "../validation-schema/post-source";
import {
  PostStatusType,
  type TPostStatusType,
} from "../validation-schema/post-status-type";
import type { TRoadmapMode } from "../validation-schema/roadmap-mode";
import { memberTable, organizationTable, userTable } from "./auth";

const VectorValues = Schema.Array(Schema.Number);
export const DEFAULT_POST_EMBEDDING_DIMENSIONS = 1536;

const embeddingVector = (dimensions: number) =>
  customType<{
    data: number[];
    driverData: string;
  }>({
    dataType: () => `vector(${dimensions})`,
    fromDriver: (value) =>
      Array.from(Schema.decodeUnknownSync(VectorValues)(JSON.parse(value))),
    toDriver: (value) =>
      JSON.stringify(Schema.decodeUnknownSync(VectorValues)(value)),
  });

export const boardVisibilityEnum = pgEnum("board_visibility", [
  "PUBLIC",
  "PRIVATE",
]);

/** Post-status types are plain text; vocabulary lives in `../post-status-type`. */
export type TPostStatus = TPostStatusType;

export const POST_STATUS_TYPES = PostStatusType.literals;

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

export const DEFAULT_CHANGELOG_CATEGORIES = [
  { name: "New", iconType: "color", icon: "oklch(0.723 0.192 149.579)" },
  { name: "Improved", iconType: "color", icon: "oklch(0.623 0.188 259.815)" },
  { name: "Fixed", iconType: "color", icon: "oklch(0.637 0.208 25.331)" },
] as const satisfies ReadonlyArray<{
  name: string;
  iconType: TChangelogCategoryIconType;
  icon: string;
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

export const savedRoadmapVisibilityEnum = pgEnum("saved_roadmap_visibility", [
  "public",
  "private",
]);

export const postCommentVisibilityEnum = pgEnum("post_comment_visibility", [
  "PUBLIC",
  "INTERNAL",
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
    uniqueIndex("tag_organizationId_name_uidx").on(
      table.organizationId,
      table.name
    ),
    uniqueIndex("tag_organizationId_slug_uidx").on(
      table.organizationId,
      table.slug
    ),
  ]
);

export const postStatusTable = pgTable(
  "post_status",
  {
    id: text("id").primaryKey(),
    type: text("type").$type<TPostStatusType>().notNull(),
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
    uniqueIndex("post_status_organizationId_id_uidx").on(
      table.organizationId,
      table.id
    ),
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

/**
 * Name of the partial unique index enforcing at most one primary roadmap per
 * organization. Shared with the roadmap repository's unique-violation
 * fallback so renames stay synchronized with generated migrations.
 */
export const ROADMAP_PRIMARY_ORGANIZATION_ID_UIDX =
  "roadmap_primary_organizationId_uidx";

export const roadmapTable = pgTable(
  "roadmap",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    mode: text("mode").$type<TRoadmapMode>().notNull(),
    visibility: savedRoadmapVisibilityEnum("visibility").notNull(),
    // An empty condition list deliberately means every post in the workspace.
    filter: jsonb("filter")
      .$type<{
        version: 1;
        operator: "and";
        conditions: Array<
          | { field: "boardId"; operator: "in"; value: string[] }
          | { field: "status"; operator: "in"; value: string[] }
          | {
              field: "tagId";
              operator: "containsAny" | "containsAll";
              value: string[];
            }
        >;
      }>()
      .notNull(),
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
    uniqueIndex("roadmap_organizationId_slug_uidx").on(
      table.organizationId,
      table.slug
    ),
    index("roadmap_organizationId_idx").on(table.organizationId),
    uniqueIndex(ROADMAP_PRIMARY_ORGANIZATION_ID_UIDX)
      .on(table.organizationId)
      .where(sql`${table.isPrimary}`),
  ]
);

export const roadmapColumnTable = pgTable(
  "roadmap_column",
  {
    id: text("id").primaryKey(),
    roadmapId: text("roadmap_id")
      .notNull()
      .references(() => roadmapTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    config: jsonb("config")
      .$type<
        | { type: "status"; statusId: string }
        | {
            type: "filter";
            filter: {
              version: 1;
              operator: "and";
              conditions: Array<
                | { field: "boardId"; operator: "in"; value: string[] }
                | { field: "status"; operator: "in"; value: string[] }
                | {
                    field: "tagId";
                    operator: "containsAny" | "containsAll";
                    value: string[];
                  }
              >;
            };
          }
      >()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("roadmap_column_roadmapId_idx").on(table.roadmapId),
    index("roadmap_column_roadmapId_position_idx").on(
      table.roadmapId,
      table.position
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
    source: text("source")
      .$type<TEntitySource>()
      .default("DASHBOARD")
      .notNull(),
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
    source: text("source")
      .$type<TEntitySource>()
      .default("DASHBOARD")
      .notNull(),
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
    etaQuarter: text("eta_quarter"),
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
    source: text("source").$type<TPostSource>().default("DASHBOARD").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    mergedIntoPostId: text("merged_into_post_id"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    embedding: embeddingVector(DEFAULT_POST_EMBEDDING_DIMENSIONS)("embedding"),
    embeddingModel: text("embedding_model"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    index("post_statusId_idx").on(table.statusId),
    index("post_archivedAt_idx").on(table.archivedAt),
    index("post_mergedIntoPostId_idx").on(table.mergedIntoPostId),
    index("post_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .where(sql`${table.embedding} is not null`),
    uniqueIndex("post_id_organizationId_uidx").on(
      table.id,
      table.organizationId
    ),
    uniqueIndex("post_organizationId_slug_uidx").on(
      table.organizationId,
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
    check(
      "post_embedding_metadata_chk",
      sql`(${table.embedding} is null and ${table.embeddingModel} is null and ${table.embeddedAt} is null) or (${table.embedding} is not null and ${table.embeddingModel} is not null and ${table.embeddedAt} is not null)`
    ),
    check(
      "post_eta_quarter_format_chk",
      sql`${table.etaQuarter} is null or ${table.etaQuarter} ~ '^[0-9]{4}-Q[1-4]$'`
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

export const changelogSubscriptionTable = pgTable(
  "changelog_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => memberTable.id, {
      onDelete: "set null",
    }),
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
    index("changelog_subscription_organizationId_idx").on(table.organizationId),
    index("changelog_subscription_userId_idx").on(table.userId),
    uniqueIndex("changelog_subscription_organizationId_userId_uidx").on(
      table.organizationId,
      table.userId
    ),
  ]
);

export const commentTable = pgTable(
  "comment",
  {
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
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
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
  },
  (table) => [
    index("comment_organizationId_postId_idx").on(
      table.organizationId,
      table.postId
    ),
    index("comment_postId_pinnedAt_idx").on(table.postId, table.pinnedAt),
    uniqueIndex("comment_post_pinned_uidx")
      .on(table.postId)
      .where(sql`${table.pinnedAt} IS NOT NULL`),
  ]
);

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

export const postActivityTable = pgTable(
  "post_activity",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    actorMemberId: text("actor_member_id").references(() => memberTable.id, {
      onDelete: "set null",
    }),
    kind: text("kind").$type<TPostActivityKind>().notNull(),
    previousValue: text("previous_value"),
    nextValue: text("next_value"),
    commentId: text("comment_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("post_activity_postId_createdAt_idx").on(
      table.postId,
      table.createdAt
    ),
    index("post_activity_organizationId_idx").on(table.organizationId),
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

export const changelogCategoryTable = pgTable(
  "changelog_category",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Icon types are plain text; vocabulary lives in `../changelog-category-icon-type`.
    iconType: text("icon_type")
      .$type<TChangelogCategoryIconType>()
      .notNull()
      .default("color"),
    icon: text("icon").notNull(),
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
    uniqueIndex("changelog_category_organizationId_name_uidx").on(
      table.organizationId,
      table.name
    ),
  ]
);

export const changelogTable = pgTable(
  "changelog",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    coverImage: text("cover_image"),
    slug: text("slug").notNull(),
    content: text("content").notNull(),
    excerpt: text("excerpt").notNull().default(""),
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

export const changelogCategoryLinkTable = pgTable(
  "changelog_category_link",
  {
    id: text("id").primaryKey(),
    changelogId: text("changelog_id")
      .notNull()
      .references(() => changelogTable.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => changelogCategoryTable.id, { onDelete: "cascade" }),
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
    index("changelog_category_link_changelogId_idx").on(table.changelogId),
    index("changelog_category_link_categoryId_idx").on(table.categoryId),
    uniqueIndex("changelog_category_link_changelogId_categoryId_uidx").on(
      table.changelogId,
      table.categoryId
    ),
  ]
);

export const changelogPostTable = pgTable(
  "changelog_post",
  {
    changelogId: text("changelog_id")
      .notNull()
      .references(() => changelogTable.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.changelogId, table.postId] }),
    uniqueIndex("changelog_post_postId_uidx").on(table.postId),
    index("changelog_post_organizationId_idx").on(table.organizationId),
  ]
);

export const contactAttributeDefinitionTable = pgTable(
  "contact_attribute_definition",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    description: text("description"),
    type: text("type").$type<TAttributeType>().notNull(),
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
    type: text("type").$type<TAttributeType>().notNull(),
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

export const emailOutboxTable = pgTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    kind: text("kind").$type<TEmailIntentKind>().notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    state: text("state").$type<TEmailOutboxState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_outbox_organizationId_deduplicationKey_uidx").on(
      table.organizationId,
      table.deduplicationKey
    ),
    index("email_outbox_state_scheduledAt_idx").on(
      table.state,
      table.scheduledAt
    ),
    index("email_outbox_organizationId_state_idx").on(
      table.organizationId,
      table.state
    ),
    uniqueIndex("email_outbox_pendingStatusAggregate_uidx")
      .on(table.organizationId, table.kind, table.aggregateId)
      .where(
        sql`${table.state} = 'pending' AND ${table.kind} = 'post.status_changed'`
      ),
  ]
);

/** One independently retryable recipient delivery for an email outbox intent. */
export const emailDeliveryTable = pgTable(
  "email_delivery",
  {
    id: text("id").primaryKey(),
    outboxId: text("outbox_id")
      .notNull()
      .references(() => emailOutboxTable.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => emailContactTable.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),
    template: text("template").notNull(),
    templateVersion: integer("template_version").notNull(),
    templatePayload: jsonb("template_payload").$type<unknown>().notNull(),
    messageId: text("message_id").notNull(),
    state: text("state").$type<TEmailDeliveryState>().notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: jsonb("last_error").$type<unknown>(),
    providerMetadata: jsonb("provider_metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_delivery_outboxId_recipientEmail_uidx").on(
      table.outboxId,
      table.recipientEmail
    ),
    uniqueIndex("email_delivery_messageId_uidx").on(table.messageId),
    index("email_delivery_state_nextAttemptAt_idx").on(
      table.state,
      table.nextAttemptAt
    ),
    index("email_delivery_contactId_idx").on(table.contactId),
  ]
);

/** A workspace-scoped email address that can optionally belong to a user. */
export const emailContactTable = pgTable(
  "email_contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    verificationState: text("verification_state")
      .$type<TEmailContactVerificationState>()
      .notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_contact_organizationId_email_uidx").on(
      table.organizationId,
      table.email
    ),
    index("email_contact_userId_idx").on(table.userId),
  ]
);

export const emailSubscriptionTable = pgTable(
  "email_subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => emailContactTable.id, { onDelete: "cascade" }),
    topicType: text("topic_type")
      .$type<TEmailSubscriptionTopicType>()
      .notNull(),
    topicId: text("topic_id"),
    source: text("source").$type<TEmailSubscriptionSource>().notNull(),
    state: text("state").$type<TEmailSubscriptionState>().notNull(),
    verificationTokenHash: text("verification_token_hash"),
    verificationExpiresAt: timestamp("verification_expires_at", {
      withTimezone: true,
    }),
    unsubscribeTokenHash: text("unsubscribe_token_hash"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("email_subscription_contactId_topicType_topicId_uidx")
      .on(table.contactId, table.topicType, table.topicId)
      .nullsNotDistinct(),
    index("email_subscription_organizationId_state_idx").on(
      table.organizationId,
      table.state
    ),
    index("email_subscription_recipientLookup_idx").on(
      table.organizationId,
      table.topicType,
      table.topicId,
      table.state,
      table.contactId
    ),
    index("email_subscription_state_organizationId_idx").on(
      table.state,
      table.organizationId
    ),
  ]
);

export const emailSuppressionTable = pgTable(
  "email_suppression",
  {
    email: text("email").primaryKey(),
    reason: text("reason").$type<TEmailSuppressionReason>().notNull(),
    providerEventId: text("provider_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_suppression_providerEventId_uidx").on(
      table.providerEventId
    ),
  ]
);

/**
 * Provider lifecycle events are an idempotency ledger. The event payload is
 * reduced to a safe, provider-neutral schema before it reaches this table.
 */
export const emailProviderEventTable = pgTable(
  "email_provider_event",
  {
    providerEventId: text("provider_event_id").primaryKey(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => emailDeliveryTable.id, { onDelete: "cascade" }),
    type: text("type").$type<TEmailProviderEventType>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metadata: jsonb("metadata").$type<unknown>().notNull(),
  },
  (table) => [
    index("email_provider_event_deliveryId_occurredAt_idx").on(
      table.deliveryId,
      table.occurredAt
    ),
  ]
);

export const notificationTable = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    kind: text("kind").$type<TNotificationEventType>().notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href").notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("notification_recipient_read_created_idx").on(
      table.recipientUserId,
      table.readAt,
      table.createdAt
    ),
    index("notification_organization_idx").on(table.organizationId),
    uniqueIndex("notification_recipient_deduplication_uidx").on(
      table.recipientUserId,
      table.deduplicationKey
    ),
  ]
);

export type InsertComment = typeof commentTable.$inferInsert;
export type PostSubscription = typeof postSubscriptionTable.$inferSelect;
export type NewPostSubscription = typeof postSubscriptionTable.$inferInsert;
export type ChangelogSubscription =
  typeof changelogSubscriptionTable.$inferSelect;
export type NewChangelogSubscription =
  typeof changelogSubscriptionTable.$inferInsert;
