import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as OpenApi from "effect/http-api/OpenApi";

import type { PublicApiVoteGroup } from "../../public-api/api-contract";
import {
  PUBLIC_API_ERROR_SCHEMAS,
  PUBLIC_API_WRITE_ERROR_SCHEMAS,
} from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import type { PublicApiCaller } from "../../public-api/middleware";
import type { PublicApiDependencies } from "../../public-api/operations";
import { parseLimit, providedQueryParam } from "../../public-api/parse";
import {
  createVoteOperation,
  deleteVoteOperation,
  listPostVotesOperation,
  listVotesOperation,
} from "./operations";
import {
  CreateVoteParams,
  CreateVotePayload,
  DeleteVoteParams,
  ListPostVotesParams,
  ListPostVotesQuery,
  ListVotesQuery,
  PublicApiVote,
  PublicApiVotePage,
  type TPublicApiVoterFilter,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiVoteGroup>;

/**
 * The voter filter a query names, or `undefined` when it names none.
 *
 * Blank parameters are "not provided", the same rule `providedQueryParam`
 * applies elsewhere, so `?voterEmail=` is an unfiltered list rather than a
 * lookup for the empty string.
 */
const voterFilterFromQuery = (query: {
  readonly voterEmail?: string | undefined;
  readonly voterExternalId?: string | undefined;
  readonly voterId?: string | undefined;
}): TPublicApiVoterFilter | undefined => {
  const id = providedQueryParam(query.voterId);
  const externalId = providedQueryParam(query.voterExternalId);
  const email = providedQueryParam(query.voterEmail);
  const voter: TPublicApiVoterFilter = {
    ...(id !== undefined && { id }),
    ...(externalId !== undefined && { externalId }),
    ...(email !== undefined && { email }),
  };
  return Object.keys(voter).length === 0 ? undefined : voter;
};

/**
 * The vote endpoints, and their HTTP implementations.
 *
 * The declarations are the published contract; the handlers do only the
 * HTTP-specific work — parsing the string query parameters — and delegate to
 * `./operations.ts`.
 */
export const voteEndpoints = [
  HttpApiEndpoint.get("listPostVotes", "/posts/:postId/votes", {
    params: ListPostVotesParams,
    query: ListPostVotesQuery,
    success: PublicApiVotePage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Votes")
    .annotate(OpenApi.Summary, "List a post's votes")
    .annotate(
      OpenApi.Description,
      "Returns the votes on one post of the calling workspace, newest first, as a cursor-paginated page. Each vote carries its id and its voter's display identity — a classification (`member` or `end_user`) and a display name and avatar, never an account identifier — and `voterId`, the workspace's own end-user record for the voter, null when a member cast it. `voterId`, `voterExternalId`, and `voterEmail` narrow the page to one customer, matched together. A post that does not exist in the workspace is reported as not found rather than as an empty page, so an id cannot be used to probe another workspace."
    ),
  HttpApiEndpoint.get("listVotes", "/votes", {
    query: ListVotesQuery,
    success: PublicApiVotePage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Votes")
    .annotate(OpenApi.Summary, "List the workspace's votes")
    .annotate(
      OpenApi.Description,
      'Returns the votes of the calling workspace across every board, newest first, as a cursor-paginated page with the same vote shape as a post\'s list. `postId` and `boardId` narrow it to one post or one board; `voterId`, `voterExternalId`, and `voterEmail` narrow it to one customer, matched together — which is how a caller answers "has this customer voted, and on what" in one request. A `postId` or `boardId` that does not exist in the workspace is reported as not found rather than as an empty page.'
    ),
  HttpApiEndpoint.post("createVote", "/posts/:postId/votes", {
    params: CreateVoteParams,
    payload: CreateVotePayload,
    success: PublicApiVote.pipe(HttpApiSchema.status(201)),
    error: PUBLIC_API_WRITE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Create Vote")
    .annotate(OpenApi.Summary, "Vote on a post on a customer's behalf")
    .annotate(
      OpenApi.Description,
      "Adds a vote to a post and returns it. The vote is attributed to the customer the author names — an API key has no user of its own — resolved by userId, contactId, externalId, or email, in that order; a customer with no account is provisioned a shadow one so the vote has an account behind it. Adding a vote the same customer already has is an idempotent success that returns the existing vote. A locked post, or one merged into another post, is refused with CONFLICT."
    ),
  HttpApiEndpoint.delete("deleteVote", "/posts/:postId/votes/:voteId", {
    params: DeleteVoteParams,
    success: HttpApiSchema.NoContent,
    // The delete can be refused by a locked or merged post, so it publishes
    // the write vocabulary's conflict alongside the base errors.
    error: PUBLIC_API_WRITE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Delete Vote")
    .annotate(OpenApi.Summary, "Remove a vote from a post")
    .annotate(
      OpenApi.Description,
      "Removes the vote named by `voteId` from the post. The vote is named by its own id rather than by the voter's account: the account identifier behind a vote is never published. A vote that is already gone is reported as not found, and a locked or merged post is refused with CONFLICT. Removing a vote never touches the voter's email subscription."
    ),
] as const;

export const voteHandlers = (
  context: Context.Context<PublicApiDependencies>
) => ({
  listPostVotes: (({ params, query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listPostVotesOperation.handler({
        ...params,
        cursor: query.cursor,
        limit,
        voter: voterFilterFromQuery(query),
      });
    }).pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "listPostVotes",
    PublicApiCaller
  >,

  listVotes: (({ query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listVotesOperation.handler({
        boardId: providedQueryParam(query.boardId),
        cursor: query.cursor,
        limit,
        postId: providedQueryParam(query.postId),
        voter: voterFilterFromQuery(query),
      });
    }).pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "listVotes",
    PublicApiCaller
  >,

  // The body is the operation's own input minus the path, so handing it over
  // cannot drop a field the operation gains.
  createVote: (({ params, payload }) =>
    createVoteOperation
      .handler({
        ...payload,
        ...params,
      })
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "createVote",
    PublicApiCaller
  >,

  deleteVote: (({ params }) =>
    deleteVoteOperation
      .handler(params)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "deleteVote",
    PublicApiCaller
  >,
});
