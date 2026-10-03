import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";
import {
  PublicApiAuthor,
  PublicApiOnBehalfAuthor,
} from "../../public-api/common";

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
});

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
export const CreateVotePayload = Schema.Struct({
  author: PublicApiOnBehalfAuthor,
});

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
});

export type TListPostVotesInput = Schema.Schema.Type<typeof ListPostVotesInput>;

/** Typed input for adding a vote to a post. */
export const CreateVoteInput = Schema.Struct({
  postId: Schema.String,
  author: PublicApiOnBehalfAuthor,
});

export type TCreateVoteInput = Schema.Schema.Type<typeof CreateVoteInput>;

/** Typed input for removing one vote from a post. */
export const DeleteVoteInput = Schema.Struct({
  postId: Schema.String,
  voteId: Schema.String,
});

export type TDeleteVoteInput = Schema.Schema.Type<typeof DeleteVoteInput>;
