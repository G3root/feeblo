import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import * as Schema from "effect/Schema";

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

export const PublicApiTag = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

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

export const PUBLIC_API_PAGE_DEFAULT_LIMIT = 25;
export const PUBLIC_API_PAGE_MAX_LIMIT = 100;
