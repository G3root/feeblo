import { currentDb, schema, withTransactionAbortRetry } from "@feeblo/db";
import type { THelpCenterArticleState } from "@feeblo/domain-contracts/help-center-article";
import {
  and,
  asc,
  cosineDistance,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  HELP_CENTER_ARTICLE_STATES,
  isHelpCenterArticleReadable,
} from "./machine";
import type { THelpCenterArticleListSort } from "./schema";
import {
  helpCenterSearchTerms,
  helpCenterSearchTsQuery,
  normalizeHelpCenterSearchQuery,
} from "./search";
import type { NormalizedHelpCenterArticleWrite } from "./write";

const article = schema.helpCenterArticleTable;

const topic = schema.helpCenterTopicTable;

const viewTotal = schema.helpCenterArticleViewTotalTable;

const viewEvent = schema.helpCenterArticleViewEventTable;

const feedback = schema.helpCenterArticleFeedbackTable;

const daily = schema.helpCenterArticleDailyTable;

const searchDaily = schema.helpCenterSearchDailyTable;

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

/**
 * The reading order: a pinned article first, then newest first.
 *
 * The id is the last key so the order is total. A window of a non-total order
 * can repeat a row (two articles with the same position, date and title) or skip
 * one between two pages, which is a bug pagination makes visible.
 */
const articleOrder = [
  sql`${article.position} asc nulls last`,
  desc(article.publishedAt),
  asc(article.title),
  asc(article.id),
] as const;

/**
 * The dashboard's order: what an editor touched last, first.
 *
 * `updatedAt` is not unique — a bulk import writes many rows in one second — so
 * the id tiebreak is what makes the window deterministic.
 */
const updatedArticleOrder = [desc(article.updatedAt), asc(article.id)] as const;

/**
 * The projection every search returns.
 *
 * One list for both halves of the search, so a lexical hit and a semantic hit
 * are the same shape and a surface projects one type. `status` travels rather
 * than a pre-computed `isArchived`, because the dashboard distinguishes a draft
 * from an archived page and the portal collapses both into "readable".
 */
const searchHitColumns = {
  id: article.id,
  slug: article.slug,
  title: article.title,
  excerpt: article.excerpt,
  status: article.status,
  topicId: article.topicId,
  topicSlug: topic.slug,
  topicName: topic.name,
} as const;

/**
 * The `tsquery` for a set of terms, or `undefined` when there are none.
 *
 * `to_tsquery` throws on malformed input, so the value bound here is always
 * one `helpCenterSearchTsQuery` produced. A term list that collapsed to
 * nothing yields `undefined`, which `and(...)` drops — and the caller never
 * asks, because `search` returns early for it.
 */
const tsQuery = (queryText: string | null) =>
  queryText === null ? undefined : sql`to_tsquery('english', ${queryText})`;

/**
 * Relevance, as the generated column's own weights describe it.
 *
 * `ts_rank_cd` rather than `ts_rank`: coverage density rewards an article that
 * uses the terms repeatedly in a short space over one that mentions them once
 * in a long body, which is the difference between the page someone wants and
 * the page that happens to contain the word.
 */
const rankOf = (queryText: string) =>
  sql<number>`ts_rank_cd(${article.searchVector}, ${tsQuery(queryText)})`;

/**
 * The title and summary as their own vector, for a strict search.
 *
 * Computed rather than stored because it is only used by the widget's
 * deflection, where the corpus is one workspace's articles and a sequential
 * scan is cheaper than a second generated column and its index. Its weights
 * match the generated column's `A` and `B`, so a strict search and a full one
 * cannot disagree about where a term was found.
 */
const titleExcerptVector = sql`to_tsvector('english'::regconfig, ${article.title} || ' ' || ${article.excerpt})`;

const makeHelpCenterArticleRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * The dashboard's list: every article in the workspace, whatever its state.
   *
   * Optionally one section's, optionally one window of them — the usage meter
   * and the section page are the same read with different scopes.
   */
  const findMany = ({
    organizationId,
    topicId,
    limit,
    offset,
    sort,
  }: {
    organizationId: string;
    topicId?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    sort?: THelpCenterArticleListSort | undefined;
  }) => {
    const ordered = db
      .select({ ...articleColumns, ...countColumns })
      .from(article)
      .where(
        and(
          eq(article.organizationId, organizationId),
          topicId === undefined ? undefined : eq(article.topicId, topicId)
        )
      )
      .orderBy(
        asc(article.topicId),
        ...(sort === "reading" ? articleOrder : updatedArticleOrder)
      );

    // A caller that names no window wants the whole list: the plan-usage meter
    // counts every article and cannot be handed a page.
    const windowed = limit === undefined ? ordered : ordered.limit(limit);

    return offset === undefined ? windowed : windowed.offset(offset);
  };

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
      .select({
        ...articleColumns,
        content: article.content,
        coverImage: article.coverImage,
        ...countColumns,
      })
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
        coverImage: article.coverImage,
        topicId: article.topicId,
        topicSlug: topic.slug,
        topicName: topic.name,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
        // The author is named, never identified: a public page shows who wrote
        // the documentation, not the internal member id.
        authorName: schema.userTable.name,
        isArchived: sql<boolean>`${article.status} = 'archived'`,
        // The page shows how often it was read. The verdict tallies are a
        // dashboard number and cost two aggregate subqueries here for nothing.
        viewCount: viewCountColumn,
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

  /**
   * Whether the workspace has an article a reader could open.
   *
   * One row, for the widget's deflection latch: the composer asks this on every
   * settle of the title, and `findManyPublic` would send the whole list back to
   * answer a yes/no question. `readableWhere` is the same filter the public
   * reads use, so this cannot disagree with the list the widget's Help tab
   * renders.
   */
  const hasReadableByOrganizationId = ({
    organizationId,
  }: {
    organizationId: string;
  }) =>
    db
      .select({ id: article.id })
      .from(article)
      .where(and(eq(article.organizationId, organizationId), readableWhere))
      .limit(1)
      .pipe(Effect.map((rows) => rows.length > 0));

  /**
   * Ranked full-text search.
   *
   * Two callers, one query. The dashboard sees every state — an editor
   * searching for the draft they half-wrote should find it — and the portal and
   * widget pass `includeUnreadable: false`, which is the same `readableWhere`
   * every other public read uses. Getting that backwards would publish a draft
   * through a search box.
   *
   * `strict` narrows the match to the title and summary. The widget uses it
   * because a suggestion beside a feedback form is only worth showing if it
   * names the thing being asked about; a body match on a passing mention is a
   * worse suggestion than none.
   *
   * No terms means no round trip: `helpCenterSearchTsQuery` returns null for
   * input that survived normalization with nothing in it, and a query that
   * cannot match should not be sent.
   */
  const search = ({
    organizationId,
    query,
    limit,
    includeUnreadable,
    strict = false,
  }: {
    organizationId: string;
    query: string;
    limit: number;
    includeUnreadable: boolean;
    strict?: boolean | undefined;
  }) => {
    const queryText = helpCenterSearchTsQuery(helpCenterSearchTerms(query));

    if (queryText === null) {
      return Effect.succeed([]);
    }

    return (
      db
        .select(searchHitColumns)
        .from(article)
        .innerJoin(topic, eq(topic.id, article.topicId))
        .where(
          and(
            eq(article.organizationId, organizationId),
            includeUnreadable ? undefined : readableWhere,
            sql`${article.searchVector} @@ ${tsQuery(queryText)}`,
            strict
              ? sql`${titleExcerptVector} @@ ${tsQuery(queryText)}`
              : undefined
          )
        )
        // `publishedAt` before `id` so the order is total without asking for a
        // tiebreak column the caller would have to carry.
        .orderBy(
          desc(rankOf(queryText)),
          desc(article.publishedAt),
          asc(article.id)
        )
        .limit(limit)
    );
  };

  /**
   * Nearest articles by cosine distance, for the semantic half of a search.
   *
   * Rows are filtered on `embedding_model` as well as `is not null`: a vector
   * from a different model lives in a different space, and comparing across
   * models returns confident nonsense rather than an error. A deployment that
   * switches `EMBEDDING_MODEL` therefore stops matching its old rows until they
   * are re-embedded, which is the honest behaviour — the alternative is
   * silently mixing two geometries.
   *
   * The column is deliberately unindexed, and this read is why. It filters on
   * `organization_id`, `status` and `embedding_model` before ordering by
   * distance, which is not the shape an ANN index serves: the planner reads
   * one workspace's rows and sorts them. `help_center_article` is bounded by
   * the plan's article ceiling, so that is a few hundred rows. A future index
   * has to be keyed the way this query filters rather than as a plain ANN
   * index — see the `embedding` column's comment in `@feeblo/db`.
   */
  const searchByVector = ({
    organizationId,
    embedding,
    embeddingModel,
    limit,
    includeUnreadable,
  }: {
    organizationId: string;
    embedding: readonly number[];
    embeddingModel: string;
    limit: number;
    includeUnreadable: boolean;
  }) => {
    const distance = cosineDistance(article.embedding, [...embedding]);

    return (
      db
        .select({
          ...searchHitColumns,
          distance: sql<number | null>`${distance}`,
        })
        .from(article)
        .innerJoin(topic, eq(topic.id, article.topicId))
        .where(
          and(
            eq(article.organizationId, organizationId),
            includeUnreadable ? undefined : readableWhere,
            isNotNull(article.embedding),
            eq(article.embeddingModel, embeddingModel)
          )
        )
        // `id` breaks a tie so the order is total; two articles can sit at the
        // same distance and a page that reorders between renders looks broken.
        .orderBy(asc(distance), asc(article.id))
        .limit(limit)
    );
  };

  /**
   * Store an article's embedding, but only if the article has not changed.
   *
   * The guard is title and content equality, the same one the post embedding
   * job uses: the job runs after the write, and an editor who saves again in
   * that window must not end up with a vector describing the text they
   * replaced. A refresh that matches nothing is not an error — it is a write
   * that arrived too late.
   *
   * `updatedAt` is deliberately not touched: this is an index refresh, not a
   * change to the article, and bumping it would make every save look like two.
   */
  const saveEmbedding = ({
    articleId,
    content,
    model,
    now,
    organizationId,
    title,
    vector,
  }: {
    articleId: string;
    content: string;
    model: string;
    now: Date;
    organizationId: string;
    title: string;
    vector: readonly number[];
  }) =>
    db
      .update(article)
      .set({
        embeddedAt: now,
        embedding: [...vector],
        embeddingModel: model,
        // Assigned to the column itself, which is what pins it: `updatedAt`
        // carries `$onUpdate`, so any statement that omits it is stamped with
        // the current time by Drizzle. A refresh is an index rebuild, not an
        // edit — without this an embedding job would move the date a reader
        // sees on the page and invalidate every cache keyed on it.
        updatedAt: article.updatedAt,
      })
      .where(
        and(
          eq(article.id, articleId),
          eq(article.organizationId, organizationId),
          eq(article.title, title),
          eq(article.content, content)
        )
      )
      .returning({ id: article.id })
      .pipe(Effect.map((rows) => rows.length > 0));

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
    creatorMemberId,
    now,
    write,
    coverImage,
  }: {
    id: string;
    organizationId: string;
    topicId: string;
    position: number | null;
    creatorMemberId: string | null;
    now: Date;
    write: NormalizedHelpCenterArticleWrite;
    coverImage: string | null;
  }) =>
    db
      .insert(article)
      .values({
        id,
        organizationId,
        topicId,
        position,
        creatorMemberId,
        slug: write.slug,
        title: write.title,
        content: write.content,
        excerpt: write.excerpt,
        coverImage,
        status: write.status,
        publishedAt: write.publishedAt,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.asVoid);

  /**
   * Replace an article's writable fields, but only while it is still in
   * `expectedStatus` and, when the caller named one, still stamped with
   * `expectedUpdatedAt`.
   *
   * The status travels in the `WHERE` clause rather than being read and
   * trusted: two editors can have the same draft open, and the one who saves
   * second must not silently undo the other's publication. The timestamp does
   * the same job for two edits inside one status, which a status guard cannot
   * see. An update that matched nothing reports that, and the caller answers
   * a conflict.
   */
  const update = ({
    id,
    organizationId,
    topicId,
    position,
    expectedStatus,
    expectedUpdatedAt,
    now,
    write,
    coverImage,
  }: {
    id: string;
    organizationId: string;
    topicId: string;
    position: number | null;
    expectedStatus: THelpCenterArticleState;
    expectedUpdatedAt: Date | undefined;
    now: Date;
    write: NormalizedHelpCenterArticleWrite;
    coverImage: string | null;
  }) => {
    /**
     * Whether this statement is changing the text an embedding describes.
     *
     * A `SET` expression reads the row as it was, so this compares the stored
     * title and body against the ones being written — one statement, no read
     * before it and no race between the two.
     */
    const textChanged = sql`${article.title} is distinct from ${write.title} or ${article.content} is distinct from ${write.content}`;

    return db
      .update(article)
      .set({
        topicId,
        position,
        slug: write.slug,
        title: write.title,
        content: write.content,
        excerpt: write.excerpt,
        coverImage,
        status: write.status,
        publishedAt: write.publishedAt,
        // The timestamp is the same concurrency token the `WHERE` below
        // compares, so an accepted write has to move it. Two saves inside one
        // millisecond would otherwise leave it equal and let a stale editor
        // through; the case makes it strictly monotonic even when the clock
        // does not.
        updatedAt: sql`case when ${article.updatedAt} >= ${now} then ${article.updatedAt} + interval '1 millisecond' else ${now} end`,
        // A vector describes the text it was generated from. Clearing it here,
        // in the same statement that changes the text, closes the window in
        // which a search could match words the article no longer has; the
        // detached job fills it again. Only a text change clears it — a
        // reorder, a retitle of the topic or a status move leaves the
        // article's meaning, and therefore its vector, alone. The three
        // columns move together because the table's check requires them to.
        embedding: sql`case when ${textChanged} then null else ${article.embedding} end`,
        embeddingModel: sql`case when ${textChanged} then null else ${article.embeddingModel} end`,
        embeddedAt: sql`case when ${textChanged} then null else ${article.embeddedAt} end`,
      })
      .where(
        and(
          eq(article.id, id),
          eq(article.organizationId, organizationId),
          eq(article.status, expectedStatus),
          // Omitted by a caller that never loaded the row: the status guard is
          // then the only concurrency guarantee it asked for.
          expectedUpdatedAt === undefined
            ? undefined
            : eq(article.updatedAt, expectedUpdatedAt)
        )
      )
      .returning({ id: article.id })
      .pipe(Effect.map((rows) => rows.map((row) => row.id)));
  };

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

            // The daily bucket, in the same transaction as the counter: a view
            // that moved one and not the other would leave the dashboard
            // disagreeing with the article page, and the retry helper replays
            // the whole body so a retried beacon still counts once.
            yield* db
              .insert(daily)
              .values({
                articleId,
                day: DateTime.formatIsoDateUtc(DateTime.fromDateUnsafe(now)),
                organizationId,
                views: 1,
              })
              .onConflictDoUpdate({
                target: [daily.articleId, daily.day],
                set: { views: sql`${daily.views} + 1` },
              });

            return true;
          })
        )
        .pipe(withTransactionAbortRetry);

      return { accepted };
    });

  /**
   * Drop search buckets older than `before`.
   *
   * `before` is a `YYYY-MM-DD` day rather than an instant, because the key is a
   * calendar day and the analytics windows are inclusive ranges of them.
   */
  const deleteSearchesBefore = (before: string) =>
    db.delete(searchDaily).where(lt(searchDaily.day, before));

  /**
   * Drop the raw events older than `before`.
   *
   * The counter is untouched: it is the all-time number and outlives the
   * events by design. Only the windowed reads lose history, which is the
   * whole reason the two tables exist separately.
   */
  const deleteEventsBefore = (before: Date) =>
    db.delete(viewEvent).where(lt(viewEvent.occurredAt, before));

  /**
   * Count one search, and whether it found anything.
   *
   * A query that normalized to nothing is not recorded: it is a box the reader
   * cleared, not a question the documentation failed to answer, and counting it
   * would make "searches that found nothing" mostly empty strings.
   *
   * The caller swallows a failure here (see the public search handler):
   * analytics must never fail the request that produced it, which is the same
   * contract the post-traffic ingest states.
   */
  const recordSearch = ({
    organizationId,
    query,
    found,
    now,
  }: {
    organizationId: string;
    query: string;
    found: boolean;
    now: DateTime.DateTime;
  }) => {
    const normalized = normalizeHelpCenterSearchQuery(query);

    // No terms means nothing a full-text index could ever match — a box the
    // reader filled with punctuation, or one they cleared. Recording it would
    // put noise in "top searches" and in "documentation gaps", and the
    // potential gaps are the list someone is expected to act on.
    if (helpCenterSearchTerms(normalized).length === 0) {
      return Effect.void;
    }

    return db
      .insert(searchDaily)
      .values({
        day: DateTime.formatIsoDateUtc(now),
        emptySearches: found ? 0 : 1,
        organizationId,
        query: normalized,
        searches: 1,
      })
      .onConflictDoUpdate({
        target: [
          searchDaily.organizationId,
          searchDaily.day,
          searchDaily.query,
        ],
        set: {
          emptySearches: sql`${searchDaily.emptySearches} + ${found ? 0 : 1}`,
          searches: sql`${searchDaily.searches} + 1`,
        },
      })
      .pipe(Effect.asVoid);
  };

  /**
   * The dashboard's analytics for one window.
   *
   * Four reads over the same two tables, run together. `sinceDay` is a UTC
   * calendar day supplied by the caller rather than computed here, so the
   * window is read through `Clock` at the edge and a test can pin it.
   *
   * `articles` keeps the verdict counters beside the views because the page
   * asks two questions of one table: what is read, and what is read and rated
   * unhelpful. A separate "lowest rated" query would be a fourth round trip to
   * answer what a `helpful` column in the same row already shows.
   */
  const analytics = ({
    organizationId,
    sinceDay,
    limit,
  }: {
    organizationId: string;
    sinceDay: string;
    limit: number;
  }) => {
    const inWindow = and(
      eq(daily.organizationId, organizationId),
      gte(daily.day, sinceDay)
    );

    const searchesInWindow = and(
      eq(searchDaily.organizationId, organizationId),
      gte(searchDaily.day, sinceDay)
    );

    return Effect.all(
      {
        totals: db
          .select({
            views: sql<number>`coalesce(sum(${daily.views}), 0)::int`,
            helpful: sql<number>`coalesce(sum(${daily.helpfulVerdicts}), 0)::int`,
            unhelpful: sql<number>`coalesce(sum(${daily.unhelpfulVerdicts}), 0)::int`,
          })
          .from(daily)
          .where(inWindow)
          .pipe(
            Effect.map(
              (rows) => rows[0] ?? { helpful: 0, unhelpful: 0, views: 0 }
            )
          ),

        articles: db
          .select({
            id: article.id,
            title: article.title,
            slug: article.slug,
            status: article.status,
            views: sql<number>`coalesce(sum(${daily.views}), 0)::int`,
            helpful: sql<number>`coalesce(sum(${daily.helpfulVerdicts}), 0)::int`,
            unhelpful: sql<number>`coalesce(sum(${daily.unhelpfulVerdicts}), 0)::int`,
          })
          .from(daily)
          .innerJoin(article, eq(article.id, daily.articleId))
          .where(inWindow)
          .groupBy(article.id, article.title, article.slug, article.status)
          .orderBy(
            sql`coalesce(sum(${daily.views}), 0) desc`,
            asc(article.title)
          )
          .limit(limit),

        queries: db
          .select({
            query: searchDaily.query,
            searches: sql<number>`coalesce(sum(${searchDaily.searches}), 0)::int`,
            emptySearches: sql<number>`coalesce(sum(${searchDaily.emptySearches}), 0)::int`,
          })
          .from(searchDaily)
          .where(searchesInWindow)
          .groupBy(searchDaily.query)
          .orderBy(
            sql`coalesce(sum(${searchDaily.searches}), 0) desc`,
            asc(searchDaily.query)
          )
          .limit(limit),

        /**
         * The documentation gap: queries that returned nothing, most frequent
         * first. A subgroup of `queries` by construction, and a separate read
         * because the window's most-searched phrase and its most-fruitless one
         * are routinely different phrases.
         */
        emptyQueries: db
          .select({
            query: searchDaily.query,
            searches: sql<number>`coalesce(sum(${searchDaily.searches}), 0)::int`,
            emptySearches: sql<number>`coalesce(sum(${searchDaily.emptySearches}), 0)::int`,
          })
          .from(searchDaily)
          .where(searchesInWindow)
          .groupBy(searchDaily.query)
          .having(sql`sum(${searchDaily.emptySearches}) > 0`)
          .orderBy(
            sql`coalesce(sum(${searchDaily.emptySearches}), 0) desc`,
            asc(searchDaily.query)
          )
          .limit(limit),
      },
      { concurrency: "unbounded" }
    );
  };

  return {
    analytics,
    deleteEventsBefore,
    deleteSearchesBefore,
    findMany,
    findManyPublic,
    findById,
    findBySlugPublic,
    findStateById,
    countByOrganizationId,
    hasReadableByOrganizationId,
    create,
    update,
    remove,
    recordSearch,
    recordView,
    saveEmbedding,
    search,
    searchByVector,
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
