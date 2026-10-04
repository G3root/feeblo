import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  CrmEntryLimitReachedError,
  InvalidSubjectError,
  SubjectNotFoundError,
} from "../../identity/errors";
import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
import { crmLimitMessage } from "../../public-api/entitlement";
import {
  ConflictError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
  PlanRequiresUpgradeError,
  internalError,
  invalidRequestError,
  notFoundError,
  planRequiresUpgradeError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { currentPublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { withRemapDbErrors } from "../../rpc-errors";
import { toPublicApiVote } from "./mappers";
import { currentPublicApiVoteRepository } from "./repository";
import {
  CreateVoteInput,
  DeleteVoteInput,
  ListPostVotesInput,
  ListVotesInput,
  PublicApiVote,
  PublicApiVotePage,
  type TPublicApiVote,
} from "./schema";

const VOTE_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * A create can be refused by the post's state — a locked or merged post — and
 * because attributing it to a voter with no contact yet would provision one.
 */
const VOTE_CREATE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  ConflictError,
  PlanRequiresUpgradeError,
  InternalError,
]);

/** A delete can miss its row or be refused by the post's state. */
const VOTE_DELETE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  ConflictError,
  InternalError,
]);

/**
 * The shared on-behalf path's failures, answered on the published vocabulary.
 *
 * The identity failures carry the caller's own identifier in their detail, so
 * the published message is fixed: echoing a subject id back would make the
 * error body an existence oracle. The repository's own state checks already
 * answer on the published vocabulary — they run inside the write's transaction
 * — so those pass through unchanged. Everything else — a lost id-generation
 * race, a subscription write, a driver failure the remap did not name — has no
 * caller-actionable meaning and stays the documented internal failure.
 */
const toPublicVoteFailure = (
  cause: unknown
): InvalidRequestError | NotFoundError | ConflictError | undefined => {
  if (Schema.is(InvalidSubjectError)(cause)) {
    return invalidRequestError(
      "The vote's author could not be resolved in this workspace."
    );
  }
  if (Schema.is(SubjectNotFoundError)(cause)) {
    return invalidRequestError(
      "The vote's author could not be found in this workspace."
    );
  }
  if (
    Schema.is(NotFoundError)(cause) ||
    Schema.is(ConflictError)(cause) ||
    Schema.is(InvalidRequestError)(cause)
  ) {
    return cause;
  }
  return undefined;
};

const withVoteWriteFailures = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    withRemapDbErrors("PublicApiVote", "update"),
    Effect.mapError(
      (cause) =>
        toPublicVoteFailure(cause) ??
        internalError("The request could not be completed.")
    )
  );

/**
 * A create additionally resolves the voter's subject, so it is the only vote
 * write that can need room for a new CRM entry — and so the only one that
 * publishes `PLAN_REQUIRES_UPGRADE`.
 *
 * Its own mapper rather than an extra branch on `withVoteWriteFailures`: that
 * mapper's output union is fixed, so adding the status there would make
 * `deleteVote` advertise a failure it cannot return.
 */
const withVoteCreateFailures = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    withRemapDbErrors("PublicApiVote", "update"),
    Effect.mapError(
      (
        cause
      ):
        | InvalidRequestError
        | NotFoundError
        | ConflictError
        | PlanRequiresUpgradeError
        | InternalError => {
        // Naming a voter with no contact yet makes the write provision one,
        // which is a CRM entry like any other and is capped like any other. Same
        // remedy as the company create's limit, so it answers with that code.
        if (Schema.is(CrmEntryLimitReachedError)(cause)) {
          return planRequiresUpgradeError(crmLimitMessage);
        }
        return (
          toPublicVoteFailure(cause) ??
          internalError("The request could not be completed.")
        );
      }
    )
  );

/**
 * The vote operations.
 *
 * The writes are the dashboard's own on-behalf path (`upvote/on-behalf.ts`)
 * with a machine-key actor, so an API-added vote lands in the same transaction,
 * the same post timeline, and the same voter subscription as one a member adds
 * from the dashboard. These records are what an MCP tool or a CLI would call;
 * the HTTP endpoints in `./http.ts` only parse the request.
 */

export const listPostVotesOperation = defineOperation(
  "listPostVotes",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List a post's votes, newest first, as a cursor-paginated page. Each vote carries the voter's display identity — a classification and a display name, never an account identifier — and the end-user record id when a customer cast it. A voter filter narrows the page to one customer.",
    failure: VOTE_READ_FAILURES,
    input: ListPostVotesInput,
    output: PublicApiVotePage,
    scope: "votes.read",
  },
  ({ cursor, limit, postId, voter }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiVoteRepository;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .listPostVotes({
          cursor: after,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          postId,
          voter,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(page, {
        // Not found rather than an empty page: a post with no votes and a
        // post that does not exist must not look the same, and another
        // workspace's post is reported as missing so the id cannot probe at
        // all.
        onNone: () => Effect.fail(notFoundError("Post not found.")),
        onSome: (found) => {
          return Effect.succeed({
            data: found.votes.map(toPublicApiVote),
            nextCursor:
              found.nextCursor === null ? null : encodeCursor(found.nextCursor),
          });
        },
      });
    })
);

/**
 * The workspace-wide vote list.
 *
 * The per-post list with the post left optional, so "has this customer voted,
 * and where" is one call rather than a page of posts. `postId` and `boardId`
 * are existence-checked exactly as they are elsewhere, so neither can probe
 * another workspace.
 */
export const listVotesOperation = defineOperation(
  "listVotes",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List the workspace's votes, newest first, as a cursor-paginated page. `postId`, `boardId`, and the voter filter narrow it — the last by the voter's end-user record id, the caller's own external id, or email.",
    failure: VOTE_READ_FAILURES,
    input: ListVotesInput,
    output: PublicApiVotePage,
    scope: "votes.read",
  },
  ({ boardId, cursor, limit, postId, voter }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiVoteRepository;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .listVotes({
          boardId: boardId ?? null,
          cursor: after,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          postId: postId ?? null,
          voter,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(page, {
        // The id named something is absent from this workspace: report which
        // kind of resource it was, never that it exists elsewhere.
        onNone: () =>
          Effect.fail(
            notFoundError(
              postId === undefined ? "Board not found." : "Post not found."
            )
          ),
        onSome: (found) => {
          return Effect.succeed({
            data: found.votes.map(toPublicApiVote),
            nextCursor:
              found.nextCursor === null ? null : encodeCursor(found.nextCursor),
          });
        },
      });
    })
);

export const createVoteOperation = defineOperation(
  "createVote",
  {
    annotations: { idempotent: true },
    description:
      "Add a vote to a post, attributed to the customer the request names. Adding a vote the same customer already has is a success no-op and returns the existing vote.",
    failure: VOTE_CREATE_FAILURES,
    input: CreateVoteInput,
    output: PublicApiVote,
    scope: "votes.create",
  },
  ({ author, postId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiVoteRepository;

      // The post's state is checked inside the write's own transaction, under
      // the post row's lock: a check in a separate transaction would leave a
      // window for a concurrent lock or merge to land between the check and
      // the insert, and the write would still report success.
      const added = yield* repository
        .addVoteOnBehalf({
          organizationId: caller.organizationId,
          postId,
          subject: author,
        })
        .pipe(withVoteCreateFailures);

      // The vote is read back rather than returned from the write: the
      // repository's insert reports whether it added a row, not the row's
      // display fields, and a read is what a later `GET` would perform. A
      // vote that vanishes between the write and the read is answered as the
      // documented internal failure rather than a success with no resource.
      const vote = yield* repository
        .findVoteForUser({
          organizationId: caller.organizationId,
          postId,
          userId: added.userId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(vote, {
        onNone: () =>
          Effect.fail(
            internalError("The vote could not be read after it was recorded.")
          ),
        onSome: (found) =>
          Effect.succeed(toPublicApiVote(found) satisfies TPublicApiVote),
      });
    })
);

export const deleteVoteOperation = defineOperation(
  "deleteVote",
  {
    annotations: { destructive: true },
    description:
      "Remove one vote from a post. A vote that is already gone is reported as not found.",
    failure: VOTE_DELETE_FAILURES,
    input: DeleteVoteInput,
    output: Schema.Void,
    scope: "votes.delete",
  },
  ({ postId, voteId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiVoteRepository;

      // The removal names the vote's own id, and the repository deletes that
      // row inside one transaction that also locks the post and re-checks its
      // state. A vote that vanished — or was removed and cast again for the
      // same account — is reported as the missing resource this request named
      // rather than silently removing the newer vote.
      const removed = yield* repository
        .removeVoteById({
          organizationId: caller.organizationId,
          postId,
          voteId,
        })
        .pipe(withVoteWriteFailures);

      if (!removed.removed) {
        return yield* notFoundError("Vote not found.");
      }
    })
);

export const voteOperations = [
  listPostVotesOperation,
  listVotesOperation,
  createVoteOperation,
  deleteVoteOperation,
] as const;
