import type {
  THelpCenterArticleSource,
  THelpCenterArticleState,
} from "@feeblo/domain-contracts/help-center-article";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
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
 * A Postgres `tsvector`.
 *
 * Only ever read and written by Postgres: the article's column is generated and
 * the query builds its own vector from a parameter, so no application code
 * stores or compares a `tsvector` value. It exists here so the column can be
 * declared, indexed and generated inside the schema the migrator diffs.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

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
     * A Tabler icon *name* from the dashboard's picker, not a colour triple.
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
    /**
     * A 16:7 cover image, the same shape the changelog's pages use.
     *
     * The URL, not an asset id: the editor promotes the uploaded object before
     * the row stores it, and the public page only needs something to render.
     */
    coverImage: text("cover_image"),
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
    /**
     * The article as a full-text index, derived and never authored.
     *
     * A generated column rather than a trigger or a write-path update: the
     * three inputs live on this row, so Postgres can always compute the value
     * and no caller can forget to. That rules out the drift a trigger's
     * `UPDATE` can miss (a restored dump, a bulk insert, a migration backfill)
     * and needs no backfill pass when it ships.
     *
     * Weights are the ranking: a title match outranks a summary match, which
     * outranks a body match. That is the whole relevance model — a help center
     * is small, and a second signal would be a tuning knob nobody tunes.
     *
     * The `regconfig` is a literal, which is what makes the expression
     * immutable and therefore admissible in a generated column. A parameterized
     * config (`to_tsvector($1, …)`) would be rejected by Postgres at DDL time.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, title), 'A') || setweight(to_tsvector('english'::regconfig, excerpt), 'B') || setweight(to_tsvector('english'::regconfig, content), 'C')`
    ),
    /**
     * The semantic half of search, and deliberately unindexed.
     *
     * The nearest-neighbour read filters on `organization_id`, `status` and
     * `embedding_model` before it orders by distance, which is not the shape an
     * ANN index serves: on a table this size the planner reads the workspace's
     * rows and sorts them, so an HNSW index would be maintained on every embed
     * and never chosen. `help_center_article` is bounded by the plan's article
     * ceiling — a sequential distance scan over one workspace is a few hundred
     * rows. Revisit this with an index keyed the way the read actually filters
     * if the ceiling ever stops bounding the table.
     */
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
    // The search's only access path. GIN rather than GiST because the corpus is
    // small, updates are rare and a read is the common case, which is the
    // trade-off GIN is built for.
    index("help_center_article_search_vector_idx").using(
      "gin",
      table.searchVector
    ),

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
    // The FK cascade check on article delete reads `article_id`; without an
    // index Postgres scans the whole event table for every deleted article.
    // This is the maintenance access path, not a read path: the only product
    // read is retention, which filters on time alone.
    index("help_center_article_view_event_articleId_idx").on(table.articleId),
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
    // No single-column reference: the composite `(article_id, organization_id)`
    // foreign key below owns the tenant guard and the cascade, and a second
    // constraint on the same column would add a second thing to keep in step
    // without adding protection.
    articleId: text("article_id").notNull(),
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

/**
 * One article's traffic and verdicts, bucketed by UTC day.
 *
 * The row *is* the bucket, so the natural key is the primary key: a surrogate
 * id would be a second identity for the same fact and a second way to write it
 * twice. `onConflictDoUpdate` on that key is the whole write path.
 *
 * The two verdict counters count verdicts **cast** that day, not the current
 * distribution of them. Flipping a vote from helpful to unhelpful adds an
 * unhelpful to today and leaves the helpful on the day it was cast. Aggregating
 * today's standing distribution is what the feedback table's own `count(*)`
 * answers, and it is already what the article reads carry; keeping a second,
 * slower-moving copy of it here would be two numbers that disagree.
 *
 * The `>= 0` check earns its place because the counters move by delta. A
 * negative bucket is not a rounding artefact, it is a bug in the caller, and
 * the constraint turns it into a failed write rather than a chart that says a
 * page was un-read.
 */
export const helpCenterArticleDailyTable = pgTable(
  "help_center_article_daily",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    articleId: text("article_id").notNull(),
    /** UTC calendar day, `YYYY-MM-DD`. */
    day: date("day", { mode: "string" }).notNull(),
    views: integer("views").notNull().default(0),
    helpfulVerdicts: integer("helpful_verdicts").notNull().default(0),
    unhelpfulVerdicts: integer("unhelpful_verdicts").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.articleId, table.day] }),
    // The workspace-wide read: every article's buckets over a window.
    index("help_center_article_daily_organizationId_day_idx").on(
      table.organizationId,
      table.day
    ),
    check(
      "help_center_article_daily_counts_chk",
      sql`${table.views} >= 0 and ${table.helpfulVerdicts} >= 0 and ${table.unhelpfulVerdicts} >= 0`
    ),
    // The same composite guard the verdict table carries: a bucket cannot name
    // an article in another workspace, whatever a handler does. It is the only
    // article reference on this table — a single-column one beside it would add
    // no protection and one more constraint to keep in step.
    foreignKey({
      name: "help_center_article_daily_article_organization_fk",
      columns: [table.articleId, table.organizationId],
      foreignColumns: [
        helpCenterArticleTable.id,
        helpCenterArticleTable.organizationId,
      ],
    }).onDelete("cascade"),
  ]
);

/**
 * What readers searched the help center for, bucketed by UTC day.
 *
 * Two questions, two counters, one row. "What are people looking for" is
 * `searches` descending; "what documentation do we not have" is
 * `empty_searches` above zero, because a query with no answer is the gap. Both
 * come from the same bucket so they cannot disagree about how many searches
 * there were.
 *
 * `query` is normalized before it is stored: lowercased, whitespace collapsed,
 * bounded to the same length the search input accepts. Case and spacing are not
 * meaning, and a counter keyed on the raw text would hold `Export CSV` and
 * `export  csv` as two rows with one search each.
 *
 * The composite key includes `query`, so the table grows with distinct queries
 * rather than with searches: a help center sees human-entered text, where
 * distinct-by-day is bounded by what people actually ask. That bound is not a
 * guarantee, so rows are pruned by day after `HELP_CENTER_SEARCH_RETENTION_DAYS`
 * (90) by the help center's daily retention pass — the same window as the raw
 * view events, and one day longer than the longest analytics range, so the
 * sweep can never delete a bucket a panel still reports on.
 */
export const helpCenterSearchDailyTable = pgTable(
  "help_center_search_daily",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    /** UTC calendar day, `YYYY-MM-DD`. */
    day: date("day", { mode: "string" }).notNull(),
    query: text("query").notNull(),
    searches: integer("searches").notNull().default(0),
    /** The subset of `searches` that returned nothing. */
    emptySearches: integer("empty_searches").notNull().default(0),
  },
  (table) => [
    // The primary key's leading `(organization_id, day)` is the analytics
    // filter's access path, and no second index on the same prefix serves the
    // panel's `GROUP BY query ORDER BY sum(searches)` — that sorts an aggregate
    // the index does not hold, so the index would be maintained for nothing.
    primaryKey({ columns: [table.organizationId, table.day, table.query] }),
    check(
      "help_center_search_daily_counts_chk",
      sql`${table.searches} >= 0 and ${table.emptySearches} >= 0 and ${table.emptySearches} <= ${table.searches}`
    ),
  ]
);

export type HelpCenterTopicRow = typeof helpCenterTopicTable.$inferSelect;

export type HelpCenterArticleRow = typeof helpCenterArticleTable.$inferSelect;

export type HelpCenterArticleFeedbackRow =
  typeof helpCenterArticleFeedbackTable.$inferSelect;
