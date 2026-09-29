import * as Schema from "effect/Schema";
import { regexes } from "zod/v4/core";

import { COMMENT_CONTENT_MAX_LENGTH } from "../../content-limits";
import { PublicApiAuthor } from "../../public-api/common";

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

/** Typed input for a page of a post's comments. */
export const ListPostCommentsInput = Schema.Struct({
  postId: Schema.String,
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  limit: Schema.optional(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)).annotate({
      description: "Page size, 1–100",
    })
  ),
});

/** Typed input for reading one comment. */
export const GetCommentInput = Schema.Struct({
  commentId: Schema.String,
});

/** Typed input for commenting on a post. */
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

/** Typed input for editing a comment. */
export const UpdateCommentInput = Schema.Struct({
  commentId: Schema.String,
  content: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(COMMENT_CONTENT_MAX_LENGTH)
  ),
  visibility: Schema.optional(PublicApiCommentVisibility),
});

/** Typed input for deleting a comment and its replies. */
export const DeleteCommentInput = Schema.Struct({
  commentId: Schema.String,
});

/** Typed input for pinning a comment to the top of its post. */
export const PinCommentInput = Schema.Struct({
  commentId: Schema.String,
});

/** Typed input for unpinning a comment. */
export const UnpinCommentInput = Schema.Struct({
  commentId: Schema.String,
});
