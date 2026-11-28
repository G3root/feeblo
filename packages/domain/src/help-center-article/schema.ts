import {
  HelpCenterArticleState,
  HelpCenterArticleWriteState,
} from "@feeblo/domain-contracts/help-center-article";
import {
  HelpCenterArticleId,
  HelpCenterTopicId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

import { HELP_CENTER_SEARCH_MAX_QUERY_LENGTH } from "./search";

const ArticleTitle = S.Trim.pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(200))
);

const ArticleSlug = S.Trim.pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(200))
);

/** Bodies are bounded so a single paste cannot make one row unbounded. */
const ArticleContent = S.String.pipe(S.check(S.isMaxLength(200_000)));

/**
 * The cover image contract, mirroring the changelog's.
 *
 * An `http(s)` URL, not a key or an asset id: the row stores what a page can
 * render, and the editor's promotion step rewrites a temporary URL to the
 * permanent one before this value is persisted.
 */
const COVER_IMAGE_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

const COVER_IMAGE_URL_MAX_LENGTH = 2048;

const coverImageWithDefault = S.NullOr(
  S.String.pipe(
    S.check(S.isPattern(COVER_IMAGE_URL_PATTERN)),
    S.check(S.isMaxLength(COVER_IMAGE_URL_MAX_LENGTH))
  )
).pipe(S.withDecodingDefaultKey(Effect.succeed(null)));

const ArticlePosition = S.NullOr(
  S.Int.pipe(
    S.check(S.isGreaterThanOrEqualTo(0)),
    S.check(S.isLessThanOrEqualTo(1_000_000))
  )
);

/**
 * The derived counters the dashboard's article rows carry.
 *
 * `viewCount` is all time and comes from the counter table; the two verdict
 * counts are aggregated from the feedback rows. The dashboard list and detail
 * carry all three because both render them. The public detail keeps only
 * `viewCount` (the page shows how often it was read), and the public list
 * carries none: those reads are hot, and a counter no public surface renders
 * is three aggregate subqueries per row for nothing.
 */
export const HelpCenterArticleCounts = S.Struct({
  viewCount: S.Finite,
  helpfulCount: S.Finite,
  notHelpfulCount: S.Finite,
});

export type THelpCenterArticleCounts = S.Schema.Type<
  typeof HelpCenterArticleCounts
>;

/** The dashboard's list row: no body, because a list does not render one. */
export const HelpCenterArticleSummary = S.Struct({
  id: S.String,
  organizationId: S.String,
  topicId: S.String,
  slug: S.String,
  title: S.String,
  excerpt: S.String,
  status: HelpCenterArticleState,
  publishedAt: S.NullOr(S.DateFromString),
  position: S.NullOr(S.Finite),
  source: S.String,
  creatorMemberId: S.NullOr(S.String),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  ...HelpCenterArticleCounts.fields,
});

export type THelpCenterArticleSummary = S.Schema.Type<
  typeof HelpCenterArticleSummary
>;

/** The dashboard's detail row: the list row, the body and the cover image. */
export const HelpCenterArticle = S.Struct({
  ...HelpCenterArticleSummary.fields,
  coverImage: S.NullOr(S.String),
  content: S.String,
});

export type THelpCenterArticle = S.Schema.Type<typeof HelpCenterArticle>;

/**
 * The portal's detail payload.
 *
 * It names its topic by slug and title rather than making the reader join, and
 * it carries no `creatorMemberId` and no `organizationId` — internal
 * identifiers a public page has no use for.
 *
 * `isArchived` is a boolean rather than the raw status: a reader needs "this
 * page is out of date", not the workspace's internal vocabulary.
 *
 * Only `viewCount` travels: the page shows how often it was read, while the
 * verdict tallies are a dashboard number the feedback panel reads on its own.
 */
export const HelpCenterArticlePublic = S.Struct({
  id: S.String,
  slug: S.String,
  title: S.String,
  excerpt: S.String,
  content: S.String,
  topicId: S.String,
  topicSlug: S.String,
  topicName: S.String,
  publishedAt: S.NullOr(S.DateFromString),
  updatedAt: S.DateFromString,
  authorName: S.NullOr(S.String),
  coverImage: S.NullOr(S.String),
  isArchived: S.Boolean,
  viewCount: S.Finite,
});

export type THelpCenterArticlePublic = S.Schema.Type<
  typeof HelpCenterArticlePublic
>;

/**
 * The portal's list row.
 *
 * No counters at all: a list renders a title, a summary and where the page
 * lives. Reading three aggregates per row to avoid rendering them would cost
 * the list the most expensive part of its query.
 */
export const HelpCenterArticlePublicSummary = S.Struct({
  id: S.String,
  slug: S.String,
  title: S.String,
  excerpt: S.String,
  topicId: S.String,
  topicSlug: S.String,
  topicName: S.String,
  publishedAt: S.NullOr(S.DateFromString),
  updatedAt: S.DateFromString,
  isArchived: S.Boolean,
});

export type THelpCenterArticlePublicSummary = S.Schema.Type<
  typeof HelpCenterArticlePublicSummary
>;

/**
 * The most rows one dashboard list request may ask for.
 *
 * It is a ceiling on a window, not a page size: a section page's window grows
 * with every `Load more` (the live query asks for all loaded pages at once), so
 * this is also where a very large section stops being browsable a page at a
 * time. That section is documentation an editor should search, not scroll.
 */
export const HELP_CENTER_ARTICLE_LIST_MAX_LIMIT = 500;

/**
 * The orders a dashboard list can be read in.
 *
 * `reading` is the public pages' order — pinned first, then newest published —
 * and `updated` is the one a section page shows, the article an editor touched
 * last. Both end in the article id, so each is a total order: a window of one
 * cannot repeat or skip a row. `updated` is the default because the dashboard is
 * the only caller of this read.
 */
export const HelpCenterArticleListSort = S.Literals(["reading", "updated"]);

export type THelpCenterArticleListSort = S.Schema.Type<
  typeof HelpCenterArticleListSort
>;

/**
 * The dashboard's article list, optionally scoped to one section and windowed.
 *
 * The scope is server-side rather than a client filter: a workspace-wide list
 * spends three counter subqueries on every article it returns, and a section
 * page only ever renders one section's rows. Omitting `topicId` keeps the
 * workspace-wide read for the plan-usage meter.
 *
 * `limit` and `offset` are the page a section page asks for, and omitting them
 * keeps the unbounded read the usage meter needs. They are optional rather than
 * defaulted here because the two callers want opposite things: a meter counts
 * every article, a list renders one window of them.
 */
export const HelpCenterArticleList = S.Struct({
  organizationId: WorkspaceId.schema,
  topicId: S.optional(HelpCenterTopicId.schema),
  limit: S.optional(
    S.Int.pipe(
      S.check(S.isGreaterThanOrEqualTo(1)),
      S.check(S.isLessThanOrEqualTo(HELP_CENTER_ARTICLE_LIST_MAX_LIMIT))
    )
  ),
  offset: S.optional(S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))),
  sort: S.optional(HelpCenterArticleListSort),
});

export type THelpCenterArticleList = S.Schema.Type<
  typeof HelpCenterArticleList
>;

/**
 * Whether a workspace's help center has anything a reader can open.
 *
 * The board's navbar asks this before drawing its Help tab: a public help
 * center with nothing in it is a tab that opens "No documentation yet". One
 * existence read answers it; the list would send a page of rows to answer a
 * yes/no question.
 */
export const HelpCenterAvailabilityGetPublic = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type THelpCenterAvailabilityGetPublic = S.Schema.Type<
  typeof HelpCenterAvailabilityGetPublic
>;

/**
 * The answer, shaped as an object rather than a bare boolean so it can grow —
 * a count, or which surfaces are served — without a new operation.
 */
export const HelpCenterAvailabilityPublic = S.Struct({
  hasArticles: S.Boolean,
});

export type THelpCenterAvailabilityPublic = S.Schema.Type<
  typeof HelpCenterAvailabilityPublic
>;

export const HelpCenterArticleListPublic = S.Struct({
  organizationId: WorkspaceId.schema,
  topicSlug: S.optional(S.String),
});

export type THelpCenterArticleListPublic = S.Schema.Type<
  typeof HelpCenterArticleListPublic
>;

export const HelpCenterArticleGet = S.Struct({
  organizationId: WorkspaceId.schema,
  id: HelpCenterArticleId.schema,
});

export type THelpCenterArticleGet = S.Schema.Type<typeof HelpCenterArticleGet>;

export const HelpCenterArticleGetPublic = S.Struct({
  organizationId: WorkspaceId.schema,
  slug: S.String,
});

export type THelpCenterArticleGetPublic = S.Schema.Type<
  typeof HelpCenterArticleGetPublic
>;

/**
 * The search box's query, on either surface.
 *
 * `query` is bounded by the same constant the stored analytics key uses, so
 * the string a reader typed is the string the dashboard counts. It is trimmed
 * for the same reason: a leading space is not a different search.
 */
const SearchQuery = S.Trim.pipe(
  S.check(S.isMaxLength(HELP_CENTER_SEARCH_MAX_QUERY_LENGTH))
);

/**
 * Re-exported so a search input's `maxLength` and this schema's ceiling are
 * the same number rather than two that can drift.
 */
export { HELP_CENTER_SEARCH_MAX_QUERY_LENGTH };

/**
 * How many hits a search may return.
 *
 * A search box shows a handful and then stops; `20` is the ceiling rather than
 * the page size, so a caller cannot turn a search into a table scan by asking
 * for everything.
 */
const SEARCH_RESULT_LIMIT = 20;

const SearchLimit = S.Int.pipe(
  S.check(S.isGreaterThanOrEqualTo(1)),
  S.check(S.isLessThanOrEqualTo(SEARCH_RESULT_LIMIT))
);

export const HelpCenterArticleSearch = S.Struct({
  organizationId: WorkspaceId.schema,
  query: SearchQuery,
  limit: S.optional(SearchLimit),
});

export type THelpCenterArticleSearch = S.Schema.Type<
  typeof HelpCenterArticleSearch
>;

/**
 * A search hit on the dashboard.
 *
 * It carries `status` and no body: the list is a jump-to-the-editor affordance,
 * so the editor navigates to the article and reads it from its own operation.
 *
 * There is no `rank` field. Order is the contract — the server decides it, and
 * `ts_rank_cd` is one of two scores that produced it, neither of which is a
 * number a caller could use for anything but re-sorting a list that is already
 * sorted.
 */
export const HelpCenterArticleSearchHit = S.Struct({
  id: S.String,
  slug: S.String,
  title: S.String,
  excerpt: S.String,
  status: HelpCenterArticleState,
  topicId: S.String,
  topicSlug: S.String,
  topicName: S.String,
});

export type THelpCenterArticleSearchHit = S.Schema.Type<
  typeof HelpCenterArticleSearchHit
>;

export const HelpCenterArticleSearchPublic = S.Struct({
  organizationId: WorkspaceId.schema,
  query: SearchQuery,
  limit: S.optional(SearchLimit),
});

export type THelpCenterArticleSearchPublic = S.Schema.Type<
  typeof HelpCenterArticleSearchPublic
>;

/**
 * A search hit on the portal.
 *
 * The same projection the public list carries — slug, title, excerpt, topic —
 * and no `status`: a reader needs "this page is out of date", not the
 * workspace's internal lifecycle state.
 */
export const HelpCenterArticleSearchResult = S.Struct({
  id: S.String,
  slug: S.String,
  title: S.String,
  excerpt: S.String,
  topicSlug: S.String,
  topicName: S.String,
  isArchived: S.Boolean,
});

export type THelpCenterArticleSearchResult = S.Schema.Type<
  typeof HelpCenterArticleSearchResult
>;

/**
 * The windows the help center's analytics offers.
 *
 * The same three the insights page offers, deliberately: two pages that report
 * "last week" and disagree about where it starts are a support ticket. They
 * are declared here rather than imported from `insights` so a change to one
 * page's windows is a decision about that page.
 */
export const HelpCenterAnalyticsRange = S.Literals(["7d", "30d", "90d"]);

export type THelpCenterAnalyticsRange = S.Schema.Type<
  typeof HelpCenterAnalyticsRange
>;

/** Days back from "now" for each window, in UTC. */
export const HELP_CENTER_ANALYTICS_RANGE_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const satisfies Record<THelpCenterAnalyticsRange, number>;

export const HelpCenterAnalyticsPayload = S.Struct({
  organizationId: WorkspaceId.schema,
  range: HelpCenterAnalyticsRange,
});

export type THelpCenterAnalyticsPayload = S.Schema.Type<
  typeof HelpCenterAnalyticsPayload
>;

/**
 * One article's traffic and verdicts over the window.
 *
 * `views` and the two verdict counters answer different questions and are not
 * expected to add up: a view is a read, a verdict is a judgment, and most
 * readers leave neither. `status` travels so the dashboard can tell a quiet
 * published article from a quiet draft.
 */
export const HelpCenterAnalyticsArticle = S.Struct({
  id: S.String,
  title: S.String,
  slug: S.String,
  status: HelpCenterArticleState,
  views: S.Finite,
  helpful: S.Finite,
  unhelpful: S.Finite,
});

export type THelpCenterAnalyticsArticle = S.Schema.Type<
  typeof HelpCenterAnalyticsArticle
>;

/** One query and how often it was asked, and how often it found nothing. */
export const HelpCenterAnalyticsQuery = S.Struct({
  query: S.String,
  searches: S.Finite,
  emptySearches: S.Finite,
});

export type THelpCenterAnalyticsQuery = S.Schema.Type<
  typeof HelpCenterAnalyticsQuery
>;

export const HelpCenterAnalytics = S.Struct({
  range: HelpCenterAnalyticsRange,
  /** `YYYY-MM-DD`, the first day the window includes, in UTC. */
  since: S.String,
  totals: S.Struct({
    views: S.Finite,
    helpful: S.Finite,
    unhelpful: S.Finite,
  }),
  articles: S.Array(HelpCenterAnalyticsArticle),
  queries: S.Array(HelpCenterAnalyticsQuery),
  emptyQueries: S.Array(HelpCenterAnalyticsQuery),
});

export type THelpCenterAnalytics = S.Schema.Type<typeof HelpCenterAnalytics>;

const publishedAtWithDefault = S.NullOr(S.DateFromString).pipe(
  S.withDecodingDefaultKey(Effect.succeed(null))
);

const positionWithDefault = ArticlePosition.pipe(
  S.withDecodingDefaultKey(Effect.succeed(null))
);

/**
 * The write fields the create and the update share.
 *
 * `slug` is optional on a create and derived from the title when omitted; the
 * update requires it, because an editor that has already shown a reader a URL
 * must not have that URL silently recomputed from a renamed title.
 */
/**
 * The editor assets this write references.
 *
 * Optional over the wire and empty by default: a caller writing Markdown with
 * absolute URLs has none. The dashboard sends the ids of the images it uploaded
 * so the handler can promote them out of the bucket's temporary prefix before
 * storing their URLs.
 */
const articleAssetIds = S.Array(S.String).pipe(
  // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
  S.withDecodingDefaultKey(Effect.succeed([] as string[]))
);

export const HelpCenterArticleCreate = S.Struct({
  assetIds: articleAssetIds,
  coverImage: coverImageWithDefault,
  id: HelpCenterArticleId.schema,
  organizationId: WorkspaceId.schema,
  topicId: HelpCenterTopicId.schema,
  title: ArticleTitle,
  slug: S.optional(ArticleSlug),
  content: ArticleContent,
  status: HelpCenterArticleWriteState,
  publishedAt: publishedAtWithDefault,
  position: positionWithDefault,
});

export type THelpCenterArticleCreate = S.Schema.Type<
  typeof HelpCenterArticleCreate
>;

export const HelpCenterArticleUpdate = S.Struct({
  assetIds: articleAssetIds,
  coverImage: coverImageWithDefault,
  id: HelpCenterArticleId.schema,
  organizationId: WorkspaceId.schema,
  topicId: HelpCenterTopicId.schema,
  title: ArticleTitle,
  slug: ArticleSlug,
  content: ArticleContent,
  status: HelpCenterArticleWriteState,
  /**
   * The status the editor had on screen when it loaded the article.
   *
   * Optional so an API caller need not track it, but the dashboard always sends
   * it: the write is constrained to rows still in this status, which is what
   * stops an editor who opened a draft from saving over a publication that
   * happened in between.
   */
  expectedStatus: S.optional(HelpCenterArticleState),
  /**
   * The `updatedAt` the editor loaded.
   *
   * When present the write is constrained to rows whose timestamp still
   * matches, so a save that raced a colleague's edit — in the same status as
   * well as across a status move — is a conflict rather than an overwrite.
   * Optional for callers that are not saving a previously loaded article.
   */
  expectedUpdatedAt: S.optional(S.DateFromString),
  publishedAt: publishedAtWithDefault,
  position: positionWithDefault,
});

export type THelpCenterArticleUpdate = S.Schema.Type<
  typeof HelpCenterArticleUpdate
>;

export const HelpCenterArticleDelete = S.Struct({
  id: HelpCenterArticleId.schema,
  organizationId: WorkspaceId.schema,
});

export type THelpCenterArticleDelete = S.Schema.Type<
  typeof HelpCenterArticleDelete
>;

/**
 * The portal's view beacon.
 *
 * `id` is the browser's idempotency key, generated per article per visit, so a
 * beacon the page retries is not a second view. It is validated as a v4 UUID so
 * the storage key is not arbitrary caller text.
 */
export const HelpCenterArticleViewRecord = S.Struct({
  organizationId: WorkspaceId.schema,
  articleId: HelpCenterArticleId.schema,
  id: S.String.check(S.isUUID(4)),
});

export type THelpCenterArticleViewRecord = S.Schema.Type<
  typeof HelpCenterArticleViewRecord
>;

/** The beacon answers the same thing whether it stored, deduplicated or discarded. */
export const HelpCenterArticleViewAccepted = S.Struct({
  accepted: S.Boolean,
});

export type THelpCenterArticleViewAccepted = S.Schema.Type<
  typeof HelpCenterArticleViewAccepted
>;
