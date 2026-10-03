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
import { parseLimit } from "../../public-api/parse";
import {
  createVoteOperation,
  deleteVoteOperation,
  listPostVotesOperation,
} from "./operations";
import {
  CreateVoteParams,
  CreateVotePayload,
  DeleteVoteParams,
  ListPostVotesParams,
  ListPostVotesQuery,
  PublicApiVote,
  PublicApiVotePage,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiVoteGroup>;

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
      "Returns the votes on one post of the calling workspace, newest first, as a cursor-paginated page. Each vote carries its id and its voter's display identity — a classification (`member` or `end_user`) and a display name and avatar, never an account identifier. A post that does not exist in the workspace is reported as not found rather than as an empty page, so an id cannot be used to probe another workspace."
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

export const voteHandlers = {
  listPostVotes: (({ params, query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listPostVotesOperation.handler({
        cursor: query.cursor,
        limit,
        postId: params.postId,
      });
    })) satisfies HandlerOf<PublicApiGroup, "listPostVotes">,

  createVote: (({ params, payload }) =>
    createVoteOperation.handler({
      author: payload.author,
      postId: params.postId,
    })) satisfies HandlerOf<PublicApiGroup, "createVote">,

  deleteVote: (({ params }) =>
    deleteVoteOperation.handler({
      postId: params.postId,
      voteId: params.voteId,
    })) satisfies HandlerOf<PublicApiGroup, "deleteVote">,
};
