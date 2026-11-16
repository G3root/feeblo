import {
  HelpCenterArticleId,
  HelpCenterTopicId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

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

const ArticlePosition = S.NullOr(
  S.Int.pipe(
    S.check(S.isGreaterThanOrEqualTo(0)),
    S.check(S.isLessThanOrEqualTo(1_000_000))
  )
);

/**
 * The derived counters every article read carries.
 *
 * `viewCount` is all time and comes from the counter table; the two verdict
 * counts are aggregated from the feedback rows. They are the same three numbers
 * on both surfaces because they answer the same questions.
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
  status: S.String,
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

/** The dashboard's detail row: the list row plus the body. */
export const HelpCenterArticle = S.Struct({
  ...HelpCenterArticleSummary.fields,
  content: S.String,
});

export type THelpCenterArticle = S.Schema.Type<typeof HelpCenterArticle>;

/**
 * The portal's detail payload.
 *
 * It names its topic by slug and title rather than making the reader join, and
 * it carries no `creatorMemberId` and no `organizationId` — internal
 * identifiers a public page has no use for (ADR 0004's rule, applied to a
 * portal payload).
 *
 * `isArchived` is a boolean rather than the raw status: a reader needs "this
 * page is out of date", not the workspace's internal vocabulary.
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
  isArchived: S.Boolean,
  ...HelpCenterArticleCounts.fields,
});

export type THelpCenterArticlePublic = S.Schema.Type<
  typeof HelpCenterArticlePublic
>;

/** The portal's list row. */
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
  ...HelpCenterArticleCounts.fields,
});

export type THelpCenterArticlePublicSummary = S.Schema.Type<
  typeof HelpCenterArticlePublicSummary
>;

export const HelpCenterArticleList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type THelpCenterArticleList = S.Schema.Type<
  typeof HelpCenterArticleList
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
export const HelpCenterArticleCreate = S.Struct({
  id: HelpCenterArticleId.schema,
  organizationId: WorkspaceId.schema,
  topicId: HelpCenterTopicId.schema,
  title: ArticleTitle,
  slug: S.optional(ArticleSlug),
  content: ArticleContent,
  status: S.Literals(["draft", "published", "archived"]),
  publishedAt: publishedAtWithDefault,
  position: positionWithDefault,
});

export type THelpCenterArticleCreate = S.Schema.Type<
  typeof HelpCenterArticleCreate
>;

export const HelpCenterArticleUpdate = S.Struct({
  id: HelpCenterArticleId.schema,
  organizationId: WorkspaceId.schema,
  topicId: HelpCenterTopicId.schema,
  title: ArticleTitle,
  slug: ArticleSlug,
  content: ArticleContent,
  status: S.Literals(["draft", "published", "archived"]),
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
