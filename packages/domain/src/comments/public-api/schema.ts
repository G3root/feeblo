import * as Schema from "effect/Schema";

import { COMMENT_CONTENT_MAX_LENGTH } from "../../content-limits";
import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";
import {
  PublicApiAuthor,
  PublicApiOnBehalfAuthor,
  type TPublicApiOnBehalfAuthor,
} from "../../public-api/common";
import { paramsOf, payloadOf } from "../../public-api/http-input";

/**
 * The comment resource: what the comment endpoints return, and the typed input
 * every comment operation takes.
 *
 * `PublicApiCommentVisibility` is restated from the dashboard's vocabulary
 * rather than imported: the published contract owns its own literals so a
 * change to the internal schema cannot silently change what a key receives.
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
export const ListPostCommentsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});

/**
 * The customer a comment is attributed to.
 *
 * The shared on-behalf subject under the name this resource reads it by; the
 * shape and its rules live in `public-api/common.ts` because a vote is
 * attributed by the same rules. Required, not optional: an API key is a machine
 * credential with no user behind it, so the request has to say whose name the
 * comment carries.
 */
export const PublicApiCommentAuthorSubject = PublicApiOnBehalfAuthor;

export type TPublicApiCommentAuthorSubject = TPublicApiOnBehalfAuthor;

/**
 * The comment a create writes.
 *
 * `author` is required: an API key has no user of its own, so the request has
 * to name the customer the comment is attributed to. `parentCommentId` makes
 * the comment a reply, and must name a comment on the same post and workspace.
 * `visibility` defaults to `PUBLIC`; an INTERNAL comment is a workspace note,
 * visible to keys but not on the public board.
 */
export const CreateCommentInput = Schema.Struct({
  postId: Schema.String,
  content: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(COMMENT_CONTENT_MAX_LENGTH)
  ),
  visibility: Schema.optional(PublicApiCommentVisibility),
  parentCommentId: Schema.optional(Schema.NullOr(Schema.String)),
  author: PublicApiCommentAuthorSubject,
});

/** The post the URL names, taken from the operation input. */
export const CreateCommentParams = paramsOf(CreateCommentInput, ["postId"]);

/** The create body: the operation input without the post the URL names. */
export const CreateCommentPayload = payloadOf(CreateCommentInput, ["postId"]);

export type TCreateCommentPayload = Schema.Schema.Type<
  typeof CreateCommentPayload
>;

/**
 * The comment's writable fields.
 *
 * `content` is required because a comment is its body, and unlike a company
 * update there is no meaningful "I only renamed it" case for an omitted field
 * to express; an empty body is refused rather than stored as a comment that
 * renders as nothing. `visibility` is optional: omitting it leaves the stored
 * visibility alone, which is the one field an update may leave untouched.
 */
export const UpdateCommentInput = Schema.Struct({
  commentId: Schema.String,
  content: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(COMMENT_CONTENT_MAX_LENGTH)
  ),
  visibility: Schema.optional(PublicApiCommentVisibility),
});

/** The comment the URL names, taken from the operation input. */
export const UpdateCommentParams = paramsOf(UpdateCommentInput, ["commentId"]);

/** The update body: the operation input without the comment the URL names. */
export const UpdateCommentPayload = payloadOf(UpdateCommentInput, [
  "commentId",
]);

export type TUpdateCommentPayload = Schema.Schema.Type<
  typeof UpdateCommentPayload
>;

/** Typed input for a page of a post's comments. */
export const ListPostCommentsInput = Schema.Struct({
  postId: Schema.String,
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  limit: Schema.optional(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(PUBLIC_API_PAGE_MAX_LIMIT)
    ).annotate({
      description: "Page size, 1–100",
    })
  ),
});

/** The post the URL names, taken from the operation input. */
export const ListPostCommentsParams = paramsOf(ListPostCommentsInput, [
  "postId",
]);

/** Typed input for reading one comment. */
export const GetCommentInput = Schema.Struct({
  commentId: Schema.String,
});

/** The comment the URL names, taken from the operation input. */
export const GetCommentParams = paramsOf(GetCommentInput, ["commentId"]);

/** Typed input for deleting a comment and its replies. */
export const DeleteCommentInput = Schema.Struct({
  commentId: Schema.String,
});

/** The comment the URL names, taken from the operation input. */
export const DeleteCommentParams = paramsOf(DeleteCommentInput, ["commentId"]);

/** Typed input for pinning a comment to the top of its post. */
export const PinCommentInput = Schema.Struct({
  commentId: Schema.String,
});

/** The comment the URL names, taken from the operation input. */
export const PinCommentParams = paramsOf(PinCommentInput, ["commentId"]);

/** Typed input for unpinning a comment. */
export const UnpinCommentInput = Schema.Struct({
  commentId: Schema.String,
});

/** The comment the URL names, taken from the operation input. */
export const UnpinCommentParams = paramsOf(UnpinCommentInput, ["commentId"]);
