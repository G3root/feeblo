import { currentDb, Database, schema } from "@feeblo/db";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EmailSubscriptionRepository } from "../../email-subscription/repository";
import {
  ResolvePrincipalService,
  type OnBehalfSubject,
} from "../../identity/service";
import { PostActivityRepository } from "../../post-activity/repository";
import type { Cursor } from "../../public-api/cursor";
import { withRemapDbErrors } from "../../rpc-errors";
import { UserRepository } from "../../user/repository";
import { addVoteOnBehalf, removeVoteOnBehalf } from "../on-behalf";
import { UpvoteRepository } from "../repository";

/** An author reduced to a classification and display fields — never an id. */
export type PublicApiVoteAuthor = {
  readonly type: "member" | "end_user";
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
};

/**
 * What the vote mapper is allowed to read.
 *
 * Narrow for the same reason as `PublicApiCommentSource`: `upvote` carries
 * `userId` and `memberId`, and the query reduces the second one to a
 * classification in SQL so neither identifier can reach a response.
 */
export type PublicApiVoteSource = {
  readonly id: string;
  readonly postId: string;
  readonly author: PublicApiVoteAuthor;
  readonly createdAt: Date;
};

export type PublicApiVotePage = {
  readonly votes: readonly PublicApiVoteSource[];
  readonly nextCursor: Cursor | null;
};

/**
 * The vote column list, and the only place a vote field is selected from.
 *
 * `userId` and `memberId` are deliberately absent: `userId` is the internal
 * actor identifier `public-actor.ts` forbids, and `memberId` is reduced to the
 * author classification in SQL rather than selected and branched on in
 * TypeScript, so neither can leak through a mapper.
 */
const VOTE_COLUMNS = {
  id: schema.upvoteTable.id,
  postId: schema.upvoteTable.postId,
  createdAt: schema.upvoteTable.createdAt,
  authorType: sql<
    "member" | "end_user"
  >`case when ${schema.upvoteTable.memberId} is null then 'end_user' else 'member' end`,
  authorName: schema.userTable.name,
  authorAvatarUrl: schema.userTable.image,
} as const;

type VoteRow = {
  id: string;
  postId: string;
  createdAt: Date;
  authorType: "member" | "end_user";
  authorName: string | null;
  authorAvatarUrl: string | null;
};

const toVoteSource = (row: VoteRow): PublicApiVoteSource => ({
  id: row.id,
  postId: row.postId,
  author: {
    type: row.authorType,
    displayName: row.authorName,
    avatarUrl: row.authorAvatarUrl,
  },
  createdAt: row.createdAt,
});

/**
 * Vote reads as the Public API alone performs them.
 *
 * The writes are the shared on-behalf path (`upvote/on-behalf.ts`) — the same
 * resolution, timeline entry, and subscription the dashboard's voter
 * management performs — so this service holds only the reads and the two
 * internal lookups a write needs, whose projections are public-specific:
 * `userId` and `memberId` must never be selected into a response, and the
 * author classification is computed in SQL.
 */
const makePublicApiVoteRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  // The shared on-behalf write path drives these from the fiber context
  // rather than from a value it holds, so the repository keeps a handle on
  // each of them and provides them to the two write adapters below. The same
  // shape `PublicApiPostRepository` uses for the shared post write path.
  const crypto = yield* Crypto.Crypto;
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const activities = yield* PostActivityRepository;
  const resolvePrincipal = yield* ResolvePrincipalService;
  const upvotes = yield* UpvoteRepository;
  const users = yield* UserRepository;

  /**
   * Provides the services the shared on-behalf write path reads from the
   * fiber context.
   *
   * The HTTP layer answers a handler's service requirement with a `Request`
   * failure rather than satisfying it from the route layer, so a handler that
   * carried these would fail at request time while the layers were sitting
   * right beside it. Closing over them here keeps every vote handler on the
   * public surface requirement-free.
   */
  const provideVoteWriteEnvironment = <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) =>
    effect.pipe(
      Effect.provideService(Database.Database, db),
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.provideService(EmailSubscriptionRepository, emailSubscriptions),
      Effect.provideService(PostActivityRepository, activities),
      Effect.provideService(ResolvePrincipalService, resolvePrincipal),
      Effect.provideService(UpvoteRepository, upvotes),
      Effect.provideService(UserRepository, users)
    );

  return {
    /**
     * One page of a post's votes, newest first.
     *
     * Ordered and paged exactly like a post's comments and a board's posts —
     * the same `(createdAt, id)` tuple and the same cursor — so a caller
     * learns one paging rule for the whole API. Fetches `limit + 1` rows to
     * learn whether another page exists without a second query.
     */
    listPostVotes: ({
      cursor,
      limit,
      organizationId,
      postId,
    }: {
      cursor: Cursor | null;
      limit: number;
      organizationId: string;
      postId: string;
    }) =>
      Effect.gen(function* () {
        // Distinguish a post with no votes from one that does not exist in this
        // workspace before running the page query: otherwise both come back as
        // a successful empty page, and the caller cannot tell them apart.
        // Another workspace's post is reported the same way as a missing one,
        // so the id cannot be used to probe other workspaces.
        const post = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1);

        if (post.length === 0) {
          return Option.none();
        }

        const conditions: SQL[] = [
          eq(schema.upvoteTable.organizationId, organizationId),
          eq(schema.upvoteTable.postId, postId),
        ];
        if (cursor !== null) {
          conditions.push(
            sql`(${schema.upvoteTable.createdAt}, ${schema.upvoteTable.id}) < (${cursor.createdAt}, ${cursor.id})`
          );
        }

        const rows = yield* db
          .select(VOTE_COLUMNS)
          .from(schema.upvoteTable)
          // The voter is joined rather than left-joined: `upvote.userId` is
          // not null, so a vote always has an account behind it.
          .innerJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.upvoteTable.userId)
          )
          .where(and(...conditions))
          .orderBy(
            desc(schema.upvoteTable.createdAt),
            desc(schema.upvoteTable.id)
          )
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows.at(-1);

        return Option.some({
          votes: pageRows.map(toVoteSource),
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        } satisfies PublicApiVotePage);
      }).pipe(withRemapDbErrors("PublicApiVote", "select")),

    /**
     * The post a vote is added to: whether it exists in this workspace and
     * whether it still accepts votes.
     *
     * A locked or merged post is read-only for every interaction gate in the
     * dashboard, and the shared on-behalf path does not re-check it, so the
     * state is read here and the operation answers the published conflict.
     */
    findVoteTarget: ({
      organizationId,
      postId,
    }: {
      organizationId: string;
      postId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: schema.postTable.id,
            lockedAt: schema.postTable.lockedAt,
            mergedIntoPostId: schema.postTable.mergedIntoPostId,
          })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiVote", "select")),

    /**
     * One vote on a post, by the account behind it.
     *
     * Used to read back the vote a create just resolved, and to answer the
     * published not-found when a write's row vanishes before the read. The
     * account id is an input, never a field of the result.
     */
    findVoteForUser: ({
      organizationId,
      postId,
      userId,
    }: {
      organizationId: string;
      postId: string;
      userId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(VOTE_COLUMNS)
          .from(schema.upvoteTable)
          .innerJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.upvoteTable.userId)
          )
          .where(
            and(
              eq(schema.upvoteTable.organizationId, organizationId),
              eq(schema.upvoteTable.postId, postId),
              eq(schema.upvoteTable.userId, userId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0)).pipe(Option.map(toVoteSource));
      }).pipe(withRemapDbErrors("PublicApiVote", "select")),

    /**
     * Adds one voter on behalf of a resolved customer.
     *
     * The behavior is the shared `upvote/on-behalf.ts` path — the same
     * resolution, idempotent insert, timeline entry, and voter subscription
     * the dashboard's `UpvoteAddOnBehalf` performs — with a machine-key actor,
     * because a key is not a member and has no person to record.
     */
    addVoteOnBehalf: (args: {
      readonly organizationId: string;
      readonly postId: string;
      readonly subject: OnBehalfSubject;
    }) =>
      provideVoteWriteEnvironment(
        addVoteOnBehalf({
          actor: { memberId: null, userId: null },
          organizationId: args.organizationId,
          postId: args.postId,
          subject: args.subject,
        })
      ),

    /**
     * Removes exactly one voter's vote on behalf of the workspace.
     *
     * The behavior is the shared `upvote/on-behalf.ts` path — a non-voter is a
     * success no-op, a removal records the same provenance the dashboard
     * records, and the voter's email subscription is left alone.
     */
    removeVoteOnBehalf: (args: {
      readonly organizationId: string;
      readonly postId: string;
      readonly userId: string;
    }) =>
      provideVoteWriteEnvironment(
        removeVoteOnBehalf({
          actor: { memberId: null, userId: null },
          organizationId: args.organizationId,
          postId: args.postId,
          userId: args.userId,
        })
      ),

    /**
     * The vote a delete names, and the state of the post it sits on.
     *
     * The account id is selected only so the shared removal can name the voter
     * it removes and record the same provenance the dashboard records; it is
     * not mapped into a payload. The post state travels with the row so a
     * delete cannot remove a vote from a post that has since been locked or
     * merged without answering the documented conflict.
     */
    findVoteForRemoval: ({
      organizationId,
      postId,
      voteId,
    }: {
      organizationId: string;
      postId: string;
      voteId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: schema.upvoteTable.id,
            userId: schema.upvoteTable.userId,
            lockedAt: schema.postTable.lockedAt,
            mergedIntoPostId: schema.postTable.mergedIntoPostId,
          })
          .from(schema.upvoteTable)
          .innerJoin(
            schema.postTable,
            eq(schema.postTable.id, schema.upvoteTable.postId)
          )
          .where(
            and(
              eq(schema.upvoteTable.id, voteId),
              eq(schema.upvoteTable.postId, postId),
              eq(schema.upvoteTable.organizationId, organizationId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiVote", "select")),
  };
});

export class PublicApiVoteRepository extends Context.Service<PublicApiVoteRepository>()(
  "PublicApiVoteRepository",
  {
    make: makePublicApiVoteRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so handlers take services from the context the composition
 * provides — the same shape as `currentPublicApiCaller`.
 */
export const currentPublicApiVoteRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, PublicApiVoteRepository))
);
