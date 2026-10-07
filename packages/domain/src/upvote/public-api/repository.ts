import { currentDb, Database, schema } from "@feeblo/db";
import {
  and,
  desc,
  eq,
  getTableName,
  inArray,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
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
import { PostRepository } from "../../post/repository";
import type { Cursor } from "../../public-api/cursor";
import { conflictError, notFoundError } from "../../public-api/errors";
import { withRemapDbErrors } from "../../rpc-errors";
import { UserRepository } from "../../user/repository";
import { addVoteOnBehalf, recordVoteRemoved } from "../on-behalf";
import { UpvoteRepository } from "../repository";
import type { TPublicApiVoterFilter } from "./schema";

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
 * classification in SQL so neither identifier can reach a response. `voterId`
 * is the exception, and it is not the account id: it is the workspace's own
 * end-user record, null for a member's vote, and the handle
 * `GET /end-users/{endUserId}` addresses — see the DTO's own comment.
 */
export type PublicApiVoteSource = {
  readonly id: string;
  readonly postId: string;
  readonly voterId: string | null;
  readonly author: PublicApiVoteAuthor;
  readonly createdAt: Date;
};

export type PublicApiVotePage = {
  readonly votes: readonly PublicApiVoteSource[];
  readonly nextCursor: Cursor | null;
};

/**
 * The contact alias every "the record for this account" read uses.
 *
 * One account can have more than one contact row — `contact.user_id` is
 * indexed but not unique per workspace — so the published `voterId` and the
 * `voterId`/`voterExternalId` filter have to name the same record, or a
 * caller could filter by one and be handed a vote labelled with the other.
 * Both pick the workspace's oldest contact for the account through this alias
 * and this ordering, so the label and the filter cannot disagree.
 */
const voterContact = alias(schema.contactTable, "voter_contact");

/**
 * The subquery's own FROM clause.
 *
 * `alias()` names the table in a column reference (`"voter_contact"."id"`),
 * but interpolating the aliased table into a raw `sql` fragment renders only
 * the alias name, and `from "voter_contact"` would read as a table of that
 * name rather than an alias of `contact`. The base table is therefore spelled
 * out beside the alias, the way the query builder's own FROM rendering does.
 */
const voterContactFrom = sql`${sql.identifier(
  getTableName(schema.contactTable)
)} as ${sql.identifier("voter_contact")}`;

const oldestContactIdForAccount = (
  organizationId: AnyPgColumn,
  userId: AnyPgColumn
) => sql<string | null>`(
  select ${voterContact.id}
  from ${voterContactFrom}
  where ${voterContact.organizationId} = ${organizationId}
    and ${voterContact.userId} = ${userId}
  order by ${voterContact.createdAt}, ${voterContact.id}
  limit 1
)`;

/**
 * The vote column list, and the only place a vote field is selected from.
 *
 * `userId` and `memberId` are deliberately absent: `userId` is the internal
 * actor identifier `public-actor.ts` forbids, and `memberId` is reduced to the
 * author classification in SQL rather than selected and branched on in
 * TypeScript, so neither can leak through a mapper. `voterId` is the
 * end-user record's own id — null when a member cast the vote — which is the
 * one identifier this resource publishes and the one its voter filter matches.
 *
 * It is read through a correlated subquery rather than a join because
 * `contact.user_id` is indexed but not unique per workspace: a voter with two
 * contact rows would make a join emit the vote twice, once per contact and
 * with two different `voterId` values, and the page cursor — which is the
 * vote's own `(createdAt, id)` — could then skip a duplicate. The subquery
 * picks the oldest contact for the account, the same record the voter filter
 * requires, so a vote appears exactly once and always under the record a
 * filtered request asked for.
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
  voterId: sql<
    string | null
  >`case when ${schema.upvoteTable.memberId} is null then ${oldestContactIdForAccount(
    schema.upvoteTable.organizationId,
    schema.upvoteTable.userId
  )} else null end`,
} as const;

type VoteRow = {
  id: string;
  postId: string;
  createdAt: Date;
  authorType: "member" | "end_user";
  authorName: string | null;
  authorAvatarUrl: string | null;
  voterId: string | null;
};

const toVoteSource = (row: VoteRow): PublicApiVoteSource => ({
  id: row.id,
  postId: row.postId,
  voterId: row.voterId,
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
  const posts = yield* PostRepository;
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

  /**
   * Locks the post row and rejects a state that no longer accepts vote
   * changes.
   *
   * Must run inside the write's own transaction: the row lock is what keeps a
   * concurrent lock or merge from landing between this check and the write,
   * which is the race a check in a separate transaction cannot close. The
   * failure vocabulary is the published one, so the operation does not have to
   * translate a policy denial.
   */
  const requireVotablePost = (args: {
    readonly organizationId: string;
    readonly postId: string;
  }) =>
    Effect.gen(function* () {
      const post = yield* posts.findActivityState({
        id: args.postId,
        organizationId: args.organizationId,
      });

      if (post === undefined) {
        return yield* notFoundError("Post not found.");
      }
      if (post.mergedIntoPostId !== null) {
        return yield* conflictError(
          "This post has been merged into another post and cannot be voted on."
        );
      }
      if (post.lockedAt !== null) {
        return yield* conflictError(
          "This post is locked and no longer accepts votes."
        );
      }
    }).pipe(withRemapDbErrors("PublicApiVote", "select"));

  /**
   * The accounts a voter filter names, or `None` when no filter was given.
   *
   * Matching is a lookup, never a resolution: a read must not create the
   * contact an on-behalf write would, so an identifier that matches nothing
   * yields an empty set and the caller gets an empty page. A contact's linked
   * account is what `upvote.userId` points at; the user table is consulted too
   * because a member's vote has no contact row and their email is still a
   * meaningful way to name them. The identifiers are matched together, so
   * naming two that belong to different people matches nobody — the same
   * "every identifier present must match" rule the post retrieve endpoint uses.
   *
   * That is also why the user-table leg runs only when the email is the sole
   * identifier: it exists for a member, who has no contact to match an id or
   * an external id against, so combining it with either would let the email
   * alone satisfy a filter the contact identifiers already refused.
   */
  const resolveVoterUserIds = (args: {
    readonly organizationId: string;
    readonly voter: TPublicApiVoterFilter | undefined;
  }) =>
    Effect.gen(function* () {
      const { voter } = args;
      const email = voter?.email?.trim().toLowerCase();
      const hasEmail = email !== undefined && email.length > 0;

      if (
        voter?.id === undefined &&
        voter?.externalId === undefined &&
        !hasEmail
      ) {
        return Option.none<readonly string[]>();
      }

      const contactConditions: SQL[] = [
        eq(schema.contactTable.organizationId, args.organizationId),
        isNotNull(schema.contactTable.userId),
      ];
      if (voter?.id !== undefined) {
        contactConditions.push(eq(schema.contactTable.id, voter.id));
      }
      if (voter?.externalId !== undefined) {
        contactConditions.push(
          eq(schema.contactTable.externalId, voter.externalId)
        );
      }
      if (hasEmail) {
        contactConditions.push(
          sql`lower(${schema.contactTable.email}) = ${email}`
        );
      }

      // A record identifier names the record a vote is published under, not
      // just any record linked to the same account: the label is always the
      // account's oldest contact, so a filter naming a different one owns no
      // votes and yields an empty page rather than a vote attributed to its
      // twin. An email is not a record identifier — it names a person — so it
      // keeps matching whichever record carries it.
      if (voter?.id !== undefined || voter?.externalId !== undefined) {
        contactConditions.push(
          sql`${schema.contactTable.id} = ${oldestContactIdForAccount(
            schema.contactTable.organizationId,
            schema.contactTable.userId
          )}`
        );
      }

      const contacts = yield* db
        .select({ userId: schema.contactTable.userId })
        .from(schema.contactTable)
        .where(and(...contactConditions));

      // The user-table leg is for a member, who has no contact row: it runs
      // only when the email is the sole identifier, so it can never widen a
      // filter that also names an id or an external id.
      const emailOnly =
        hasEmail && voter?.id === undefined && voter?.externalId === undefined;
      const emailUsers = emailOnly
        ? yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(sql`lower(${schema.userTable.email}) = ${email}`)
        : [];

      const ids = new Set<string>();
      for (const contact of contacts) {
        if (contact.userId !== null) {
          ids.add(contact.userId);
        }
      }
      for (const user of emailUsers) {
        ids.add(user.id);
      }
      return Option.some(Array.from(ids));
    });

  /**
   * One page of votes, newest first, with the voter and their end-user record
   * joined in.
   *
   * The rows are ordered and paged exactly like a post's comments and a
   * board's posts — the same `(createdAt, id)` tuple and the same cursor — so
   * a caller learns one paging rule for the whole API. Fetches `limit + 1`
   * rows to learn whether another page exists without a second query.
   */
  const selectVotePage = (args: {
    readonly conditions: readonly SQL[];
    readonly limit: number;
  }) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select(VOTE_COLUMNS)
        .from(schema.upvoteTable)
        // The voter is joined rather than left-joined: `upvote.userId` is not
        // null, so a vote always has an account behind it. The end-user record
        // is read by `VOTE_COLUMNS`' own subquery, not a join, so a voter with
        // two contacts cannot duplicate the vote.
        .innerJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.upvoteTable.userId)
        )
        .where(and(...args.conditions))
        .orderBy(
          desc(schema.upvoteTable.createdAt),
          desc(schema.upvoteTable.id)
        )
        .limit(args.limit + 1);

      const hasMore = rows.length > args.limit;
      const pageRows = hasMore ? rows.slice(0, args.limit) : rows;
      const lastRow = pageRows.at(-1);

      return {
        votes: pageRows.map(toVoteSource),
        nextCursor:
          hasMore && lastRow !== undefined
            ? { createdAt: lastRow.createdAt, id: lastRow.id }
            : null,
      } satisfies PublicApiVotePage;
    });

  /** The cursor tuple every vote page is paged by. */
  const voteCursorCondition = (cursor: Cursor): SQL =>
    sql`(${schema.upvoteTable.createdAt}, ${schema.upvoteTable.id}) < (${cursor.createdAt}, ${cursor.id})`;

  /** An empty page, for a filter that matches no voter. */
  const emptyVotePage = Option.some({
    votes: [],
    nextCursor: null,
  } satisfies PublicApiVotePage);

  return {
    /**
     * One page of a post's votes, newest first, optionally narrowed to one
     * voter.
     */
    listPostVotes: ({
      cursor,
      limit,
      organizationId,
      postId,
      voter,
    }: {
      cursor: Cursor | null;
      limit: number;
      organizationId: string;
      postId: string;
      voter: TPublicApiVoterFilter | undefined;
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

        const voterUserIds = yield* resolveVoterUserIds({
          organizationId,
          voter,
        });
        if (Option.isSome(voterUserIds) && voterUserIds.value.length === 0) {
          return emptyVotePage;
        }

        const conditions: SQL[] = [
          eq(schema.upvoteTable.organizationId, organizationId),
          eq(schema.upvoteTable.postId, postId),
        ];
        if (cursor !== null) {
          conditions.push(voteCursorCondition(cursor));
        }
        if (Option.isSome(voterUserIds)) {
          conditions.push(
            inArray(schema.upvoteTable.userId, [...voterUserIds.value])
          );
        }

        return Option.some(yield* selectVotePage({ conditions, limit }));
      }).pipe(withRemapDbErrors("PublicApiVote", "select")),

    /**
     * One page of the workspace's votes, newest first, optionally narrowed by
     * post, board, or voter.
     *
     * A `postId` or `boardId` that names nothing in the workspace is reported
     * as not found rather than as an empty page, exactly like the post list
     * and the per-post vote list, so neither id can probe another workspace.
     */
    listVotes: ({
      boardId,
      cursor,
      limit,
      organizationId,
      postId,
      voter,
    }: {
      boardId: string | null;
      cursor: Cursor | null;
      limit: number;
      organizationId: string;
      postId: string | null;
      voter: TPublicApiVoterFilter | undefined;
    }) =>
      Effect.gen(function* () {
        if (postId !== null) {
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
        }

        if (boardId !== null) {
          const board = yield* db
            .select({ id: schema.boardTable.id })
            .from(schema.boardTable)
            .where(
              and(
                eq(schema.boardTable.id, boardId),
                eq(schema.boardTable.organizationId, organizationId)
              )
            )
            .limit(1);
          if (board.length === 0) {
            return Option.none();
          }
        }

        const voterUserIds = yield* resolveVoterUserIds({
          organizationId,
          voter,
        });
        if (Option.isSome(voterUserIds) && voterUserIds.value.length === 0) {
          return emptyVotePage;
        }

        const conditions: SQL[] = [
          eq(schema.upvoteTable.organizationId, organizationId),
        ];
        if (postId !== null) {
          conditions.push(eq(schema.upvoteTable.postId, postId));
        }
        if (boardId !== null) {
          conditions.push(
            inArray(
              schema.upvoteTable.postId,
              db
                .select({ id: schema.postTable.id })
                .from(schema.postTable)
                .where(
                  and(
                    eq(schema.postTable.boardId, boardId),
                    eq(schema.postTable.organizationId, organizationId)
                  )
                )
            )
          );
        }
        if (cursor !== null) {
          conditions.push(voteCursorCondition(cursor));
        }
        if (Option.isSome(voterUserIds)) {
          conditions.push(
            inArray(schema.upvoteTable.userId, [...voterUserIds.value])
          );
        }

        return Option.some(yield* selectVotePage({ conditions, limit }));
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
     * because a key is not a member and has no person to record. The post's
     * state is checked under its row lock inside the same transaction, so a
     * concurrent lock or merge cannot slip between the check and the insert.
     */
    addVoteOnBehalf: (args: {
      readonly organizationId: string;
      readonly postId: string;
      readonly subject: OnBehalfSubject;
    }) =>
      db.transaction(() =>
        Effect.gen(function* () {
          yield* requireVotablePost(args);
          return yield* provideVoteWriteEnvironment(
            addVoteOnBehalf({
              actor: { memberId: null, userId: null },
              organizationId: args.organizationId,
              postId: args.postId,
              subject: args.subject,
            })
          );
        })
      ),

    /**
     * Removes exactly the vote a delete names.
     *
     * The row is deleted by its own id inside one transaction that first locks
     * the post and re-checks its state, so neither a concurrent lock or merge
     * nor a removal-and-re-vote for the same account can make this request
     * delete a vote it did not name. The activity entry carries the same
     * provenance the dashboard's removal records.
     */
    removeVoteById: (args: {
      readonly organizationId: string;
      readonly postId: string;
      readonly voteId: string;
    }) =>
      db.transaction(() =>
        Effect.gen(function* () {
          yield* requireVotablePost(args);

          const removed = yield* upvotes.removeById({
            organizationId: args.organizationId,
            postId: args.postId,
            voteId: args.voteId,
          });
          if (Option.isNone(removed)) {
            return { removed: false } as const;
          }

          yield* provideVoteWriteEnvironment(
            recordVoteRemoved({
              actor: { memberId: null, userId: null },
              organizationId: args.organizationId,
              postId: args.postId,
              userId: removed.value.userId,
            })
          );

          return { removed: true } as const;
        })
      ),
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
