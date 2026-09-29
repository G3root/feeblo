import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import * as Schema from "effect/Schema";
import { regexes } from "zod/v4/core";

import { COMMENT_CONTENT_MAX_LENGTH } from "../content-limits";

/**
 * The Public API's wire contract for v1.
 *
 * These schemas are hand-written and closed. They deliberately do not reuse the
 * dashboard or public-portal response schemas: `PostListItem` carries
 * `creatorId` and `creatorMemberId`, which are internal actor identifiers the
 * portal nulls before responding, and a field added there must not silently
 * widen what an API key can read. Adding a field here is therefore always two
 * edits — the DTO and its mapper — and is visible in review. See ADR 0004.
 */

/** Identity of a post's author, never an internal identifier. */
export const PublicApiAuthor = Schema.Struct({
  type: Schema.Literals(["member", "end_user"]),
  displayName: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});

export type TPublicApiAuthor = Schema.Schema.Type<typeof PublicApiAuthor>;

export const PublicApiPostStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: PostStatusType,
});

/**
 * A tag as it appears inside a post.
 *
 * Deliberately only its identity: a post list embeds tags to label the post,
 * and the tag's slug and timestamps would repeat on every post that carries
 * it. The full resource is `PublicApiTagDetail`.
 */
export const PublicApiTag = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export type TPublicApiTag = Schema.Schema.Type<typeof PublicApiTag>;

const ETA_QUARTER_PATTERN = /^[0-9]{4}-Q[1-4]$/;

/** List projection: everything except the post body. */
export const PublicApiPostSummary = Schema.Struct({
  id: Schema.String,
  boardId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  excerpt: Schema.String,
  url: Schema.String,
  status: PublicApiPostStatus,
  etaQuarter: Schema.NullOr(
    Schema.String.check(Schema.isPattern(ETA_QUARTER_PATTERN))
  ),
  tags: Schema.Array(PublicApiTag),
  voteCount: Schema.Number,
  commentCount: Schema.Number,
  author: PublicApiAuthor,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
  lockedAt: Schema.NullOr(Schema.DateFromString),
  archivedAt: Schema.NullOr(Schema.DateFromString),
  mergedIntoPostId: Schema.NullOr(Schema.String),
});

export type TPublicApiPostSummary = Schema.Schema.Type<
  typeof PublicApiPostSummary
>;

/** Detail projection: the summary plus the sanitized body. */
export const PublicApiPost = Schema.Struct({
  ...PublicApiPostSummary.fields,
  content: Schema.String,
});

export type TPublicApiPost = Schema.Schema.Type<typeof PublicApiPost>;

export const PublicApiPostPage = Schema.Struct({
  data: Schema.Array(PublicApiPostSummary),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiPostPage = Schema.Schema.Type<typeof PublicApiPostPage>;

/**
 * Query parameters are declared as strings and validated in the handler.
 *
 * A typed parameter would make the framework reject a malformed request with
 * its own error body, which is not this API's documented envelope; validating
 * here keeps every failure on the published vocabulary (`INVALID_REQUEST`).
 */
export const ListBoardPostsParams = Schema.Struct({
  boardId: Schema.String,
});

export const ListBoardPostsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  includeArchived: Schema.optional(Schema.String),
});

export const GetPostParams = Schema.Struct({
  postId: Schema.String,
});

/**
 * The tag resource: what the tag endpoints return.
 *
 * Separate from `PublicApiTag` rather than a widening of it, so adding a field
 * to a tag does not silently change every post payload that embeds one. The
 * workspace is not named: a key reads exactly one workspace, so the field
 * would be the same string on every response.
 */
export const PublicApiTagDetail = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiTagDetail = Schema.Schema.Type<typeof PublicApiTagDetail>;

export const PublicApiTagPage = Schema.Struct({
  data: Schema.Array(PublicApiTagDetail),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiTagPage = Schema.Schema.Type<typeof PublicApiTagPage>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListTagsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});

export const GetTagParams = Schema.Struct({
  tagId: Schema.String,
});

/**
 * The name is the only writable field.
 *
 * `slug` is derived from it on every write, exactly as the dashboard derives
 * it, so the two surfaces cannot disagree about what a tag is called.
 */
export const CreateTagPayload = Schema.Struct({
  name: Schema.String,
});

export type TCreateTagPayload = Schema.Schema.Type<typeof CreateTagPayload>;

export const UpdateTagParams = Schema.Struct({
  tagId: Schema.String,
});

export const UpdateTagPayload = Schema.Struct({
  name: Schema.String,
});

export type TUpdateTagPayload = Schema.Schema.Type<typeof UpdateTagPayload>;

export const DeleteTagParams = Schema.Struct({
  tagId: Schema.String,
});

/**
 * The complete set of tags a post should carry.
 *
 * A replacement rather than add and remove calls: the dashboard's own tag
 * picker works this way, and a caller that states the final set cannot leave a
 * tag behind by forgetting to remove it. An empty array clears the post.
 */
export const SetPostTagsPayload = Schema.Struct({
  tagIds: Schema.Array(Schema.String),
});

export type TSetPostTagsPayload = Schema.Schema.Type<typeof SetPostTagsPayload>;

export const SetPostTagsParams = Schema.Struct({
  postId: Schema.String,
});

/**
 * The tags a post carries after a write.
 *
 * The embedded tag shape, not the tag resource: these are references to tags,
 * and a caller that wants a slug or a timestamp reads the tag itself.
 */
export const PublicApiPostTags = Schema.Struct({
  data: Schema.Array(PublicApiTag),
});

export type TPublicApiPostTags = Schema.Schema.Type<typeof PublicApiPostTags>;

/**
 * A comment's visibility, restated from the dashboard's vocabulary rather than
 * imported: the published contract owns its own literals so a change to the
 * internal schema cannot silently change what a key receives.
 */
export const PublicApiCommentVisibility = Schema.Literals([
  "PUBLIC",
  "INTERNAL",
]);

export type TPublicApiCommentVisibility = Schema.Schema.Type<
  typeof PublicApiCommentVisibility
>;

/**
 * A comment as the comment endpoints return it.
 *
 * Hand-written and closed like every other DTO here, and narrow for the same
 * reason: `comment` also carries `userId` and `memberId`, the internal actor
 * identifiers `public-actor.ts` keeps out of public payloads. `postId` and
 * `parentCommentId` are kept — a comment belongs to a post and may be a reply
 * — while `mergedFromPostId` and `statusUpdateId` are not: they describe a
 * merge and a status transition rather than the comment a caller reads.
 *
 * The author reuses `PublicApiAuthor`: it is already identity-only (a
 * classification and two display fields) and is the same concept on a post and
 * on a comment, so there is no detail projection for it to drift from.
 */
export const PublicApiComment = Schema.Struct({
  id: Schema.String,
  postId: Schema.String,
  content: Schema.String,
  visibility: PublicApiCommentVisibility,
  parentCommentId: Schema.NullOr(Schema.String),
  pinnedAt: Schema.NullOr(Schema.DateFromString),
  author: PublicApiAuthor,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiComment = Schema.Schema.Type<typeof PublicApiComment>;

export const PublicApiCommentPage = Schema.Struct({
  data: Schema.Array(PublicApiComment),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiCommentPage = Schema.Schema.Type<
  typeof PublicApiCommentPage
>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListPostCommentsParams = Schema.Struct({
  postId: Schema.String,
});

export const ListPostCommentsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});

export const GetCommentParams = Schema.Struct({
  commentId: Schema.String,
});

/**
 * The customer a comment is attributed to.
 *
 * Required, not optional: an API key is a machine credential with no user
 * behind it, so the request has to say whose name the comment carries. The
 * identifiers are consulted in the same strict priority order the dashboard's
 * on-behalf payload uses (`userId` > `contactId` > `externalId` > `email`),
 * and `name`/`avatarUrl` only enrich the resolved contact.
 *
 * The email rule is restated from the dashboard's `AuthorEmail` filter
 * (`post/schema.ts`) rather than imported, because this module may not import
 * a dashboard schema. Both feed `ResolvePrincipalService`, so a junk address
 * accepted here would persist a contact the dashboard refuses; the check is
 * the same Zod-core pattern on purpose.
 */
export const PublicApiCommentAuthorSubject = Schema.Struct({
  userId: Schema.optional(Schema.String),
  contactId: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.String),
  email: Schema.optional(
    Schema.String.check(
      Schema.makeFilter((email: string) => regexes.email.test(email), {
        message: "author.email must be a valid email address",
      })
    )
  ),
  name: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
});

export type TPublicApiCommentAuthorSubject = Schema.Schema.Type<
  typeof PublicApiCommentAuthorSubject
>;

/**
 * The comment a request creates.
 *
 * `parentCommentId` is a reply; a parent outside the workspace or the post is
 * rejected rather than silently stored against a foreign comment. `visibility`
 * defaults to `PUBLIC`, and an INTERNAL comment is a workspace note: it is
 * visible to keys, but not on the public board.
 */
export const CreateCommentParams = Schema.Struct({
  postId: Schema.String,
});

/**
 * The comment a create writes.
 *
 * `author` is required: an API key has no user of its own, so the request has
 * to name the customer the comment is attributed to. `parentCommentId` makes
 * the comment a reply, and must name a comment on the same post and workspace.
 * `visibility` defaults to `PUBLIC`; an INTERNAL comment is a workspace note,
 * visible to keys but not on the public board.
 */
export const CreateCommentPayload = Schema.Struct({
  content: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(COMMENT_CONTENT_MAX_LENGTH)
  ),
  visibility: Schema.optional(PublicApiCommentVisibility),
  parentCommentId: Schema.optional(Schema.NullOr(Schema.String)),
  author: PublicApiCommentAuthorSubject,
});

export type TCreateCommentPayload = Schema.Schema.Type<
  typeof CreateCommentPayload
>;

export const UpdateCommentParams = Schema.Struct({
  commentId: Schema.String,
});

/**
 * The comment's writable fields.
 *
 * `content` is required because a comment is its body, and unlike a company
 * update there is no meaningful "I only renamed it" case for an omitted field
 * to express; an empty body is refused rather than stored as a comment that
 * renders as nothing. `visibility` is optional: omitting it leaves the stored
 * visibility alone, which is the one field an update may leave untouched.
 */
export const UpdateCommentPayload = Schema.Struct({
  content: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(COMMENT_CONTENT_MAX_LENGTH)
  ),
  visibility: Schema.optional(PublicApiCommentVisibility),
});

export type TUpdateCommentPayload = Schema.Schema.Type<
  typeof UpdateCommentPayload
>;

export const DeleteCommentParams = Schema.Struct({
  commentId: Schema.String,
});

export const PinCommentParams = Schema.Struct({
  commentId: Schema.String,
});

export const UnpinCommentParams = Schema.Struct({
  commentId: Schema.String,
});

/**
 * Where a company record came from.
 *
 * Written out rather than imported from the internal `EntitySource`, and named
 * after the field it types the way `PostStatusType` is: the repository's narrow
 * source type uses this same union, so a source added to the internal
 * vocabulary fails to compile there until it is named here too. That keeps a
 * widening of the public payload a deliberate edit — this DTO and its mapper —
 * instead of something a shared vocabulary does on its own. See ADR 0004.
 */
export const PublicApiCompanySourceType = Schema.Literals([
  "DASHBOARD",
  "WIDGET",
  "API",
  "IMPORT",
]);

export type TPublicApiCompanySourceType = Schema.Schema.Type<
  typeof PublicApiCompanySourceType
>;

/**
 * The company resource.
 *
 * A company is an account record: a name, the caller's own identifier for it,
 * an avatar, and where it came from. The people attached to it are deliberately
 * absent — a company's contacts, their emails, and their phone numbers are the
 * CRM data this version of the API does not expose — and so are the custom
 * attribute values a workspace may have defined, whose definitions are a
 * workspace-specific vocabulary rather than a fixed field.
 *
 * The workspace is not named either: a key reads exactly one workspace, so the
 * field would be the same string on every response.
 */
export const PublicApiCompany = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  externalId: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(Schema.String),
  externalCreatedAt: Schema.NullOr(Schema.DateFromString),
  source: PublicApiCompanySourceType,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiCompany = Schema.Schema.Type<typeof PublicApiCompany>;

export const PublicApiCompanyPage = Schema.Struct({
  data: Schema.Array(PublicApiCompany),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiCompanyPage = Schema.Schema.Type<
  typeof PublicApiCompanyPage
>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListCompaniesQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});

export const GetCompanyParams = Schema.Struct({
  companyId: Schema.String,
});

/**
 * The id is minted by the server, never chosen by the caller.
 *
 * An integration that already has its own identifiers for these companies
 * carries them in `externalId`, which is unique per workspace, rather than
 * trying to make the primary key agree with a system the workspace does not
 * control.
 *
 * `externalCreatedAt` is the caller's own notion of when the company was
 * created. It is stored beside `createdAt` rather than replacing it, the same
 * way the dashboard records it.
 */
export const CreateCompanyPayload = Schema.Struct({
  name: Schema.String,
  externalId: Schema.optional(Schema.NullOr(Schema.String)),
  avatar: Schema.optional(Schema.NullOr(Schema.String)),
  externalCreatedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

export type TCreateCompanyPayload = Schema.Schema.Type<
  typeof CreateCompanyPayload
>;

export const UpdateCompanyParams = Schema.Struct({
  companyId: Schema.String,
});

/**
 * A partial update: an absent field is left alone, `null` clears it.
 *
 * `name` is not nullable because a company without a name is not a company,
 * and the same holds for the unique index the name carries. A body that names
 * no field at all is rejected rather than being answered as a successful write
 * that changed nothing.
 */
export const UpdateCompanyPayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.NullOr(Schema.String)),
  avatar: Schema.optional(Schema.NullOr(Schema.String)),
  externalCreatedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

export type TUpdateCompanyPayload = Schema.Schema.Type<
  typeof UpdateCompanyPayload
>;

export const DeleteCompanyParams = Schema.Struct({
  companyId: Schema.String,
});

export const PUBLIC_API_PAGE_DEFAULT_LIMIT = 25;
export const PUBLIC_API_PAGE_MAX_LIMIT = 100;

/**
 * Changelog entry status. Restated rather than imported from the dashboard's
 * `changelog/schema.ts` for the same reason every other DTO here is: the
 * published vocabulary belongs to this module, so a change to the dashboard
 * schema cannot silently change what a key receives.
 */
export const PublicApiChangelogStatus = Schema.Literals([
  "draft",
  "scheduled",
  "published",
]);

export type TPublicApiChangelogStatus = Schema.Schema.Type<
  typeof PublicApiChangelogStatus
>;

/**
 * A changelog entry without its body.
 *
 * Carries no author and no internal identifier: a machine key is not a member,
 * and `changelog` also holds `creatorId` and `creatorMemberId`, which no
 * public payload may name. The workspace is not named either — a key reads
 * exactly one workspace, so the field would be the same string everywhere.
 */
export const PublicApiChangelogSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  excerpt: Schema.String,
  coverImage: Schema.NullOr(Schema.String),
  status: PublicApiChangelogStatus,
  scheduledAt: Schema.NullOr(Schema.DateFromString),
  publishedAt: Schema.NullOr(Schema.DateFromString),
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiChangelogSummary = Schema.Schema.Type<
  typeof PublicApiChangelogSummary
>;

/** Detail projection: the summary plus the stored, sanitized body. */
export const PublicApiChangelog = Schema.Struct({
  ...PublicApiChangelogSummary.fields,
  content: Schema.String,
});

export type TPublicApiChangelog = Schema.Schema.Type<typeof PublicApiChangelog>;

export const PublicApiChangelogPage = Schema.Struct({
  data: Schema.Array(PublicApiChangelogSummary),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiChangelogPage = Schema.Schema.Type<
  typeof PublicApiChangelogPage
>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListChangelogQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});

export const GetChangelogParams = Schema.Struct({
  changelogId: Schema.String,
});

const COVER_IMAGE_URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const COVER_IMAGE_URL_MAX_LENGTH = 2048;

/**
 * The writable fields, in the shape both writes take.
 *
 * `slug` is optional on both: omitted or empty derives it from the title, and
 * a supplied value is normalized through the same `slugify` the dashboard
 * uses, so an id-looking string cannot become a URL and `UI Kit` and `ui-kit`
 * remain one slug rather than two entries that look identical to a reader.
 *
 * The timestamps are only meaningful next to the status that selects them, so
 * a publish must carry `publishedAt` and a schedule must carry `scheduledAt`;
 * the handler rejects the request otherwise instead of inventing a date that
 * would decide a reader's ordering.
 */
export const CreateChangelogPayload = Schema.Struct({
  title: Schema.String,
  slug: Schema.optional(Schema.String),
  content: Schema.String,
  coverImage: Schema.optional(
    Schema.NullOr(
      Schema.String.check(
        Schema.isPattern(COVER_IMAGE_URL_PATTERN),
        Schema.isMaxLength(COVER_IMAGE_URL_MAX_LENGTH)
      )
    )
  ),
  status: Schema.optional(PublicApiChangelogStatus),
  scheduledAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

export type TCreateChangelogPayload = Schema.Schema.Type<
  typeof CreateChangelogPayload
>;

export const UpdateChangelogParams = Schema.Struct({
  changelogId: Schema.String,
});

/**
 * A full replacement of the writable fields.
 *
 * `status` is required here but optional on a create: a create that omits it
 * makes a draft, while an update that omitted it would silently move an entry —
 * publishing a draft or reverting a published entry — by leaving a field out.
 * The caller has to say which status it intends.
 */
export const UpdateChangelogPayload = Schema.Struct({
  title: Schema.String,
  slug: Schema.optional(Schema.String),
  content: Schema.String,
  coverImage: Schema.optional(
    Schema.NullOr(
      Schema.String.check(
        Schema.isPattern(COVER_IMAGE_URL_PATTERN),
        Schema.isMaxLength(COVER_IMAGE_URL_MAX_LENGTH)
      )
    )
  ),
  status: PublicApiChangelogStatus,
  scheduledAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

export type TUpdateChangelogPayload = Schema.Schema.Type<
  typeof UpdateChangelogPayload
>;

export const DeleteChangelogParams = Schema.Struct({
  changelogId: Schema.String,
});
