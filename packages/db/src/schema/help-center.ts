import type {
  THelpCenterArticleSource,
  THelpCenterArticleState,
} from "@feeblo/domain-contracts/help-center-article";
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { DEFAULT_EMBEDDING_DIMENSIONS, embeddingVector } from "./embedding";

export const helpCenterVisibilityEnum = pgEnum("help_center_visibility", [
  "PUBLIC",
  "HIDDEN",
]);

/**
 * A section of the help center, and the container every article belongs to.
 *
 * Flat and ordered. Nesting is a two-level tree at most in every help center
 * that has it, and a self-referencing `parent_id` makes an orphaned subtree a
 * representable state — so a second level, if it is ever wanted, is a separate
 * parent table rather than a nullable self-FK here.
 *
 * `position` is not null with a `0` default: a nullable sort key forces every
 * read to write `NULLS LAST`, and "position is unset" is not a state the
 * product has. Ties break on name.
 */
export const helpCenterTopicTable = pgTable(
  "help_center_topic",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * An icon *name* from the dashboard's icon set, not a colour triple.
     * `changelog_category` carries `icon_type` beside `icon` because it
     * predates a decision about icon families; a new table picks one
     * representation rather than encoding a union as two columns.
     */
    icon: text("icon"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("help_center_topic_organizationId_slug_uidx").on(
      table.organizationId,
      table.slug
    ),
    // The target of the article's composite foreign key, so an article cannot
    // name a topic in another workspace even if a handler is wrong.
    uniqueIndex("help_center_topic_id_organizationId_uidx").on(
      table.id,
      table.organizationId
    ),
    index("help_center_topic_organizationId_position_idx").on(
      table.organizationId,
      table.position
    ),
  ]
);

/**
 * One documentation page.
 *
 * The body is sanitized Markdown, and that is a load-bearing decision rather
 * than a formatting preference: it is what lets an article be served as
 * `text/markdown`, quoted into an assistant's context, and round-tripped
 * against a Markdown file in a repository. A body stored as editor JSON would
 * support the first of those and not the other two.
 *
 * There is no `deleted_at`. Posts, changelogs, comments and boards are hard
 * deleted here, and a non-partial unique slug index beside a soft delete
 * permanently reserves a slug for a row no editor can find. The lifecycle's
 * `archived` state is the reader-visible "this is out of date" answer, and it
 * is not a delete.
 */
export const helpCenterArticleTable = pgTable(
  "help_center_article",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    topicId: text("topic_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    /** Derived from the rendered body at write time, never authored. */
    excerpt: text("excerpt").notNull().default(""),
    status: text("status").$type<THelpCenterArticleState>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    source: text("source")
      .$type<THelpCenterArticleSource>()
      .default("EDITOR")
      .notNull(),
    creatorMemberId: text("creator_member_id").references(
      () => memberTable.id,
      { onDelete: "set null" }
    ),
    /**
     * A manual pin within a topic. Null is the normal case — most articles are
     * ordered by publication date — so this stays nullable, unlike the topic's
     * `position`, which every topic has.
     */
    position: integer("position"),
    embedding: embeddingVector(DEFAULT_EMBEDDING_DIMENSIONS)("embedding"),
    embeddingModel: text("embedding_model"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("help_center_article_organizationId_slug_uidx").on(
      table.organizationId,
      table.slug
    ),
    uniqueIndex("help_center_article_id_organizationId_uidx").on(
      table.id,
      table.organizationId
    ),
    index("help_center_article_topicId_status_position_idx").on(
      table.topicId,
      table.status,
      table.position
    ),
    index("help_center_article_organizationId_status_publishedAt_idx").on(
      table.organizationId,
      table.status,
      table.publishedAt
    ),
    index("help_center_article_creatorMemberId_idx").on(table.creatorMemberId),
    index("help_center_article_embedding_hnsw_idx")
      .using("hnsw", sql`${table.embedding} vector_cosine_ops`)
      .where(sql`${table.embedding} is not null`),
    // A live article with no publication date is not a state the vocabulary
    // should admit: entering `published` means it went live, so the write
    // paths supply the timestamp and the column cannot hold the contradiction.
    check(
      "help_center_article_published_at_chk",
      sql`${table.status} = 'draft' or ${table.publishedAt} is not null`
    ),
    // The same triple `post` carries: "is this embedding stale?" is a query
    // rather than a guess, and a half-written vector is unrepresentable.
    check(
      "help_center_article_embedding_metadata_chk",
      sql`(${table.embedding} is null and ${table.embeddingModel} is null and ${table.embeddedAt} is null) or (${table.embedding} is not null and ${table.embeddingModel} is not null and ${table.embeddedAt} is not null)`
    ),
    // RESTRICT, not CASCADE: deleting a topic must not silently delete a
    // section of documentation. The handler answers a typed conflict instead.
    foreignKey({
      name: "help_center_article_topic_organization_fk",
      columns: [table.topicId, table.organizationId],
      foreignColumns: [
        helpCenterTopicTable.id,
        helpCenterTopicTable.organizationId,
      ],
    }).onDelete("restrict"),
  ]
);

/**
 * One read of one article.
 *
 * The row is a count with a timestamp, not a person: no IP address, no user
 * agent, no visitor identifier, no cookie and no salt. That is the same
 * contract `post_view_event` states, and keeping it in the shape of the table
 * is what stops a later join from turning it into something else.
 *
 * There are no breakdown dimensions. The question a help center asks of its
 * traffic is "which articles are read", not "from where", and four unused
 * columns would be a privacy surface with no consumer. They are additive later
 * and events are pruned, so waiting costs nothing.
 *
 * `id` is the client's idempotency key, which is why it is the primary key
 * rather than a minted identifier: a retried beacon must not be a second view.
 */
export const helpCenterArticleViewEventTable = pgTable(
  "help_center_article_view_event",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => helpCenterArticleTable.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("help_center_article_view_event_articleId_occurredAt_idx").on(
      table.articleId,
      table.occurredAt
    ),
    // The retention pass filters on time alone and cannot use the pair above.
    index("help_center_article_view_event_occurredAt_idx").on(table.occurredAt),
  ]
);

/**
 * The all-time counter behind the number on an article.
 *
 * It exists because the events are pruned while the number is not: a read that
 * summed `help_center_article_view_event` would forget every view older than
 * the retention window, and the all-time count is the one number a reader
 * treats as cumulative. The events answer "which articles lately", this
 * answers "how many ever".
 */
export const helpCenterArticleViewTotalTable = pgTable(
  "help_center_article_view_total",
  {
    articleId: text("article_id")
      .primaryKey()
      .references(() => helpCenterArticleTable.id, { onDelete: "cascade" }),
    views: bigint("views", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  }
);

/**
 * One reader's verdict on one article.
 *
 * A row is the vote; the article's helpful and not-helpful counts are derived
 * from these rows and are not stored. The count columns a help center
 * conventionally carries would have to be maintained on insert, on flip and on
 * delete inside every write path, and a path that forgets drifts silently.
 * These rows are never pruned, so a `COUNT(*) FILTER (WHERE helpful)` over
 * `help_center_article_feedback_articleId_helpful_idx` is exact and cheap.
 *
 * Identity has two facets because a reader may or may not be signed in, and at
 * least one must be present. Each facet carries its own **partial** unique
 * index, which is the part that matters: a plain `unique(article_id, user_id)`
 * treats every NULL as distinct, so an anonymous reader could vote once per
 * request. `visitor_id` is a browser-generated stable id with no IP, no user
 * agent and no hash behind it — the same trust footing as a view count.
 */
export const helpCenterArticleFeedbackTable = pgTable(
  "help_center_article_feedback",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    articleId: text("article_id")
      .notNull()
      .references(() => helpCenterArticleTable.id, { onDelete: "cascade" }),
    /**
     * A signed-in reader: a member or an end user with an account.
     *
     * Cascades with the account rather than nulling, because the table's
     * identity check requires exactly one facet and a nulled `user_id` with no
     * `visitor_id` would fail it — which would turn "delete this person" into a
     * constraint violation instead of a delete. A verdict is one reader's
     * opinion; the account that cast it takes it along.
     */
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
    }),
    /** An anonymous reader, keyed to a browser-generated id. */
    visitorId: text("visitor_id"),
    helpful: boolean("helpful").notNull(),
    /**
     * Free text explaining an unhelpful vote. Admin-only, rendered as text,
     * never on a public page — so it is not sanitized Markdown: sanitizing
     * implies a renderer, and there is none.
     */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check(
      "help_center_article_feedback_identity_chk",
      sql`(${table.userId} is not null) <> (${table.visitorId} is not null)`
    ),
    // A reason belongs to the unhelpful vote it explains, so a helpful vote
    // cannot hold one. Flipping to helpful clears the column.
    //
    // `not helpful or reason is null`, not `helpful or reason is null`: the
    // latter is the same predicate with the two sides swapped, and it forbids
    // the one row this column exists for — an unhelpful vote that says why.
    check(
      "help_center_article_feedback_reason_chk",
      sql`not ${table.helpful} or ${table.reason} is null`
    ),
    uniqueIndex("help_center_article_feedback_articleId_userId_uidx")
      .on(table.articleId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("help_center_article_feedback_articleId_visitorId_uidx")
      .on(table.articleId, table.visitorId)
      .where(sql`${table.visitorId} is not null`),
    // The derived counts read through this pair.
    index("help_center_article_feedback_articleId_helpful_idx").on(
      table.articleId,
      table.helpful
    ),
    // The dashboard's reason list for one article, newest first.
    index("help_center_article_feedback_reason_idx")
      .on(table.articleId, table.createdAt)
      .where(sql`${table.reason} is not null`),
    index("help_center_article_feedback_organizationId_idx").on(
      table.organizationId
    ),
    // The same composite guard the article's topic reference carries: a verdict
    // cannot name an article in another workspace, whatever a handler does.
    foreignKey({
      name: "help_center_article_feedback_article_organization_fk",
      columns: [table.articleId, table.organizationId],
      foreignColumns: [
        helpCenterArticleTable.id,
        helpCenterArticleTable.organizationId,
      ],
    }).onDelete("cascade"),
  ]
);

export type HelpCenterTopicRow = typeof helpCenterTopicTable.$inferSelect;

export type HelpCenterArticleRow = typeof helpCenterArticleTable.$inferSelect;

export type HelpCenterArticleFeedbackRow =
  typeof helpCenterArticleFeedbackTable.$inferSelect;
