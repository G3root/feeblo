import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";
import {
  PublicApiAuthor,
  PublicApiOnBehalfAuthor,
} from "../../public-api/common";
import { payloadOf } from "../../public-api/payload";

/**
 * The vote resource: what the vote endpoints return, and the typed input every
 * vote operation takes.
 *
 * `PublicApiVote` is hand-written and closed like every other DTO here. It is
 * deliberately narrower than the dashboard's `Upvote`: that shape carries
 * `userId` and `memberId`, the internal actor identifiers `public-actor.ts`
 * keeps out of public payloads, and `mergedFromPostId`, which describes a merge
 * rather than the vote a caller reads. The author is the same identity-only
 * `PublicApiAuthor` a post and a comment carry — a classification and two
 * display fields, never an account.
 */
export const PublicApiVote = Schema.Struct({
  id: Schema.String,
  postId: Schema.String,
  /**
   * The workspace's own end-user record for the voter, or null when there is
   * none.
   *
   * This is the id `GET /end-users/{endUserId}` addresses, so a caller that
   * holds both scopes can join a vote back to the customer it belongs to
   * without paging every end user. It is an opaque handle: the record behind
   * it, and the email on it, still need `end_users.read`. Members are staff
   * rather than customers, so a member's vote is always null here; an
   * end-user vote is null only when the voter has no contact row — a legacy
   * or directly seeded account that never went through a resolution.
   */
  voterId: Schema.NullOr(Schema.String),
  author: PublicApiAuthor,
  createdAt: Schema.DateFromString,
});

export type TPublicApiVote = Schema.Schema.Type<typeof PublicApiVote>;

export const PublicApiVotePage = Schema.Struct({
  data: Schema.Array(PublicApiVote),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiVotePage = Schema.Schema.Type<typeof PublicApiVotePage>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListPostVotesParams = Schema.Struct({
  postId: Schema.String,
});

export const ListPostVotesQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  voterId: Schema.optional(Schema.String),
  voterExternalId: Schema.optional(Schema.String),
  voterEmail: Schema.optional(Schema.String),
});

/**
 * The workspace-wide vote list.
 *
 * The same page and the same voter filter as a post's list, without the post:
 * it answers "what has this customer voted on" and "what votes does this
 * board carry", which a caller reconciling a sync needs and cannot get from a
 * per-post read without paging every post.
 */
export const ListVotesQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  postId: Schema.optional(Schema.String),
  boardId: Schema.optional(Schema.String),
  voterId: Schema.optional(Schema.String),
  voterExternalId: Schema.optional(Schema.String),
  voterEmail: Schema.optional(Schema.String),
});

/**
 * The voter a vote list is filtered by.
 *
 * Declared as typed values for an operation that already has types (MCP, a
 * CLI); the HTTP projection spells them as the flat `voterId`,
 * `voterExternalId`, and `voterEmail` query parameters and assembles this
 * shape in the handler. The identifiers are matched together, so a request
 * that names an external id and an email returns the votes of a voter that
 * satisfies both; a voter that satisfies no identifier yields an empty page
 * rather than an error, because a list filter that matches nothing is not a
 * malformed request.
 */
export const PublicApiVoterFilter = Schema.Struct({
  id: Schema.optional(
    Schema.String.annotate({
      description: "The end-user record id the vote belongs to",
    })
  ),
  externalId: Schema.optional(
    Schema.String.annotate({
      description: "The caller's own identifier for the voter",
    })
  ),
  email: Schema.optional(
    Schema.String.annotate({
      description: "The voter's email address, matched case-insensitively",
    })
  ),
});

export type TPublicApiVoterFilter = Schema.Schema.Type<
  typeof PublicApiVoterFilter
>;

export const CreateVoteParams = Schema.Struct({
  postId: Schema.String,
});

/**
 * The vote a request adds.
 *
 * `author` is required: an API key has no user of its own, so the request has
 * to name the customer the vote is attributed to. The same on-behalf subject a
 * comment takes — identifiers consulted `userId` > `contactId` > `externalId` >
 * `email`, with `name`/`avatarUrl` only enriching the resolved contact — so one
 * customer resolved by two resources cannot become two contact rows.
 */
export const CreateVoteInput = Schema.Struct({
  postId: Schema.String,
  author: PublicApiOnBehalfAuthor,
});

/** The create body: the operation input without the post the URL names. */
export const CreateVotePayload = payloadOf(CreateVoteInput, ["postId"]);

export type TCreateVotePayload = Schema.Schema.Type<typeof CreateVotePayload>;

/**
 * The vote a delete removes.
 *
 * The vote is named by its own id rather than by the voter's account: the id
 * is what the list endpoint returns, and the internal `userId` behind a vote is
 * never published, so naming it would require the caller to know an identifier
 * this API deliberately withholds. Deleting a vote that is already gone is
 * reported as not found, like every other delete.
 */
export const DeleteVoteParams = Schema.Struct({
  postId: Schema.String,
  voteId: Schema.String,
});

/** Typed input for a page of a post's votes. */
export const ListPostVotesInput = Schema.Struct({
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
  voter: Schema.optional(PublicApiVoterFilter),
});

export type TListPostVotesInput = Schema.Schema.Type<typeof ListPostVotesInput>;

/** Typed input for a page of the workspace's votes. */
export const ListVotesInput = Schema.Struct({
  boardId: Schema.optional(
    Schema.String.annotate({ description: "Only votes on this board's posts" })
  ),
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
  postId: Schema.optional(
    Schema.String.annotate({ description: "Only votes on this post" })
  ),
  voter: Schema.optional(PublicApiVoterFilter),
});

export type TListVotesInput = Schema.Schema.Type<typeof ListVotesInput>;

export type TCreateVoteInput = Schema.Schema.Type<typeof CreateVoteInput>;

/** Typed input for removing one vote from a post. */
export const DeleteVoteInput = Schema.Struct({
  postId: Schema.String,
  voteId: Schema.String,
});

export type TDeleteVoteInput = Schema.Schema.Type<typeof DeleteVoteInput>;
