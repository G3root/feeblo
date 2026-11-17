import { currentDb, schema, withTransactionAbortRetry } from "@feeblo/db";
import type { THelpCenterArticleState } from "@feeblo/domain-contracts/help-center-article";
import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  HELP_CENTER_ARTICLE_STATES,
  isHelpCenterArticleReadable,
} from "./machine";
import type { NormalizedHelpCenterArticleWrite } from "./write";

const article = schema.helpCenterArticleTable;

const topic = schema.helpCenterTopicTable;

const viewTotal = schema.helpCenterArticleViewTotalTable;

const viewEvent = schema.helpCenterArticleViewEventTable;

const feedback = schema.helpCenterArticleFeedbackTable;

const articleColumns = {
  id: article.id,
  organizationId: article.organizationId,
  topicId: article.topicId,
  slug: article.slug,
  title: article.title,
  excerpt: article.excerpt,
  status: article.status,
  publishedAt: article.publishedAt,
  position: article.position,
  source: article.source,
  creatorMemberId: article.creatorMemberId,
  createdAt: article.createdAt,
  updatedAt: article.updatedAt,
} as const;

/**
 * The all-time view count for the article the enclosing query selected.
 *
 * A correlated subquery rather than a join: `help_center_article_view_total`
 * holds at most one row per article, so a join would be equally correct, but a
 * subquery keeps the article read's column list flat and lets the article
 * filter stand alone.
 */
const viewCountColumn = sql<number>`coalesce((
  select ${viewTotal.views} from ${viewTotal}
  where ${viewTotal.articleId} = ${article.id}
), 0)::int`;

const helpfulCountColumn = sql<number>`(
  select count(*)::int from ${feedback}
  where ${feedback.articleId} = ${article.id} and ${feedback.helpful}
)`;

const notHelpfulCountColumn = sql<number>`(
  select count(*)::int from ${feedback}
  where ${feedback.articleId} = ${article.id} and not ${feedback.helpful}
)`;

const countColumns = {
  viewCount: viewCountColumn,
  helpfulCount: helpfulCountColumn,
  notHelpfulCount: notHelpfulCountColumn,
} as const;

/**
 * The states a reader may open, derived from the lifecycle rather than
 * written down here.
 *
 * A state added to the machine is unreadable until `isHelpCenterArticleReadable`
 * says otherwise, which is the safe direction: shipping a new state must not
 * accidentally publish it.
 */
const READABLE_STATES: readonly THelpCenterArticleState[] =
  HELP_CENTER_ARTICLE_STATES.filter(isHelpCenterArticleReadable);

/** An archived article is a tombstone, and only `published` is documentation. */
const readableWhere = inArray(article.status, [...READABLE_STATES]);

/** A pinned article first, then newest first; the order is total. */
const articleOrder = [
  sql`${article.position} asc nulls last`,
  desc(article.publishedAt),
  asc(article.title),
] as const;

const makeHelpCenterArticleRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /** The dashboard's list: every article in the workspace, whatever its state. */
  const findMany = ({ organizationId }: { organizationId: string }) =>
    db
      .select({ ...articleColumns, ...countColumns })
      .from(article)
      .where(eq(article.organizationId, organizationId))
      .orderBy(asc(article.topicId), ...articleOrder);

  /**
   * The portal's list: readable articles, optionally under one topic.
   *
   * `topicSlug` filters by the topic's public slug rather than its id, because
   * that is the only identifier the URL carries. An unknown slug yields an
   * empty list, which the page renders as not-found — the same answer as a
   * topic that exists but holds nothing.
   */
  const findManyPublic = ({
    organizationId,
    topicSlug,
  }: {
    organizationId: string;
    topicSlug?: string | undefined;
  }) =>
    db
      .select({
        id: article.id,
        slug: article.slug,
        title: article.title,
        excerpt: article.excerpt,
        topicId: article.topicId,
        topicSlug: topic.slug,
        topicName: topic.name,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
        isArchived: sql<boolean>`${article.status} = 'archived'`,
        ...countColumns,
      })
      .from(article)
      .innerJoin(topic, eq(topic.id, article.topicId))
      .where(
        and(
          eq(article.organizationId, organizationId),
          readableWhere,
          topicSlug === undefined ? undefined : eq(topic.slug, topicSlug)
        )
      )
      .orderBy(asc(topic.position), ...articleOrder);

  const findById = ({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }) =>
    db
      .select({ ...articleColumns, content: article.content, ...countColumns })
      .from(article)
      .where(
        and(eq(article.id, id), eq(article.organizationId, organizationId))
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]));

  const findBySlugPublic = ({
    organizationId,
    slug,
  }: {
    organizationId: string;
    slug: string;
  }) =>
    db
      .select({
        id: article.id,
        slug: article.slug,
        title: article.title,
        excerpt: article.excerpt,
        content: article.content,
        topicId: article.topicId,
        topicSlug: topic.slug,
        topicName: topic.name,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
        // The author is named, never identified: a public page shows who wrote
        // the documentation, not the internal member id (ADR 0004's rule).
        authorName: schema.userTable.name,
        isArchived: sql<boolean>`${article.status} = 'archived'`,
        ...countColumns,
      })
      .from(article)
      .innerJoin(topic, eq(topic.id, article.topicId))
      .leftJoin(
        schema.memberTable,
        eq(schema.memberTable.id, article.creatorMemberId)
      )
      .leftJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.memberTable.userId)
      )
      .where(
        and(
          eq(article.organizationId, organizationId),
          eq(article.slug, slug),
          readableWhere
        )
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]));

  const countByOrganizationId = ({
    organizationId,
  }: {
    organizationId: string;
  }) =>
    db
      .select({ count: count() })
      .from(article)
      .where(eq(article.organizationId, organizationId))
      .pipe(Effect.map((rows) => rows[0]?.count ?? 0));

  /** The row's lifecycle state and publication date, for the write path. */
  const findStateById = ({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }) =>
    db
      .select({ status: article.status, publishedAt: article.publishedAt })
      .from(article)
      .where(
        and(eq(article.id, id), eq(article.organizationId, organizationId))
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]));

  const create = ({
    id,
    organizationId,
    topicId,
    position,
    now,
    write,
  }: {
    id: string;
    organizationId: string;
    topicId: string;
    position: number | null;
    now: Date;
    write: NormalizedHelpCenterArticleWrite;
  }) =>
    db
      .insert(article)
      .values({
        id,
        organizationId,
        topicId,
        position,
        slug: write.slug,
        title: write.title,
        content: write.content,
        excerpt: write.excerpt,
        status: write.status,
        publishedAt: write.publishedAt,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.asVoid);

  /**
   * Replace an article's writable fields, but only while it is still in
   * `expectedStatus`.
   *
   * The status travels in the `WHERE` clause rather than being read and
   * trusted: two editors can have the same draft open, and the one who saves
   * second must not silently undo the other's publication. An update that
   * matched nothing reports that, and the caller answers a conflict.
   */
  const update = ({
    id,
    organizationId,
    topicId,
    position,
    expectedStatus,
    now,
    write,
  }: {
    id: string;
    organizationId: string;
    topicId: string;
    position: number | null;
    expectedStatus: THelpCenterArticleState;
    now: Date;
    write: NormalizedHelpCenterArticleWrite;
  }) =>
    db
      .update(article)
      .set({
        topicId,
        position,
        slug: write.slug,
        title: write.title,
        content: write.content,
        excerpt: write.excerpt,
        status: write.status,
        publishedAt: write.publishedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(article.id, id),
          eq(article.organizationId, organizationId),
          eq(article.status, expectedStatus)
        )
      )
      .returning({ id: article.id })
      .pipe(Effect.map((rows) => rows.map((row) => row.id)));

  const remove = ({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }) =>
    db
      .delete(article)
      .where(
        and(eq(article.id, id), eq(article.organizationId, organizationId))
      )
      .pipe(Effect.asVoid);

  /**
   * Record one read, if the article is one a visitor could actually open.
   *
   * The readability check is here rather than in the transport: the endpoint is
   * public and a caller can name any article id, so counting a draft would put
   * a number on a page nobody can see, and would also answer "does this draft
   * exist" by leaking through the count.
   *
   * The event insert is idempotent on the client's id and **gates** the counter
   * increment: if the transaction aborts and the retry helper re-runs the body,
   * the previous attempt's insert rolled back with it, so the row lands once and
   * the counter moves once. A retried beacon changes nothing.
   */
  const recordView = ({
    organizationId,
    articleId,
    id,
  }: {
    organizationId: string;
    articleId: string;
    id: string;
  }) =>
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;

      const accepted = yield* db
        .transaction(() =>
          Effect.gen(function* () {
            const readable = yield* db
              .select({ id: article.id })
              .from(article)
              .where(
                and(
                  eq(article.id, articleId),
                  eq(article.organizationId, organizationId),
                  readableWhere
                )
              )
              .limit(1);

            if (readable.length === 0) {
              return false;
            }

            const inserted = yield* db
              .insert(viewEvent)
              .values({ id, articleId, occurredAt: now })
              .onConflictDoNothing()
              .returning({ id: viewEvent.id });

            if (inserted.length === 0) {
              // A retried beacon: the view is already counted.
              return true;
            }

            yield* db
              .insert(viewTotal)
              .values({ articleId, updatedAt: now, views: 1 })
              .onConflictDoUpdate({
                target: viewTotal.articleId,
                set: {
                  updatedAt: now,
                  views: sql`${viewTotal.views} + 1`,
                },
              });

            return true;
          })
        )
        .pipe(withTransactionAbortRetry);

      return { accepted };
    });

  /**
   * Drop the raw events older than `before`.
   *
   * The counter is untouched: it is the all-time number and outlives the
   * events by design. Only the windowed reads lose history, which is the
   * whole reason the two tables exist separately.
   */
  const deleteEventsBefore = (before: Date) =>
    db.delete(viewEvent).where(lt(viewEvent.occurredAt, before));

  return {
    deleteEventsBefore,
    findMany,
    findManyPublic,
    findById,
    findBySlugPublic,
    findStateById,
    countByOrganizationId,
    create,
    update,
    remove,
    recordView,
  };
});

export class HelpCenterArticleRepository extends Context.Service<HelpCenterArticleRepository>()(
  "HelpCenterArticleRepository",
  {
    make: makeHelpCenterArticleRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
