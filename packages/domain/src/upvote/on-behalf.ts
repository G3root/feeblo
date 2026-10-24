import { currentDb, schema, transaction } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { isSyntheticEmail } from "../identity/emails";
import { InvalidSubjectError } from "../identity/errors";
import {
  resolveOnBehalfSubject,
  subscribeOnBehalfSubject,
  toOnBehalfMetadata,
} from "../identity/on-behalf";
import type { OnBehalfSubject } from "../identity/service";
import { PostActivityRepository } from "../post-activity/repository";
import { UpvoteRepository } from "./repository";

/**
 * The actor columns a vote's timeline entry records.
 *
 * A member carries a person; a machine key carries none, and the entry records
 * nulls rather than inventing one. The same split `post/write.ts` uses, kept
 * local because a vote has no other member-only side effect to branch on.
 */
export type VoteWriteActor = {
  readonly memberId: string | null;
  readonly userId: string | null;
};

/**
 * Adds one voter on behalf of a resolved customer, as one transaction.
 *
 * This is the dashboard's `AddUpvoteOnBehalf` body and the Public API's
 * `createVote` body, extracted so the two cannot drift on what adding a voter
 * means: the customer is resolved inside the same transaction as the mutation
 * (see plan-on-behalf.md), an existing vote is an idempotent success no-op, and
 * a fresh vote records the `VOTE_ADDED` timeline entry with its on-behalf
 * provenance and subscribes the voter the way an admin-added voter is
 * subscribed. A machine key writes the same rows with null actor columns.
 *
 * The per-member abuse bound (`RateLimit.consumeOnBehalfWriteLimit`) stays in
 * the dashboard handler: it is a member budget, and a key has its own per-key
 * budget that the Public API's key middleware already charged.
 */
export const addVoteOnBehalf = (args: {
  readonly actor: VoteWriteActor;
  readonly organizationId: string;
  readonly postId: string;
  readonly subject: OnBehalfSubject;
}) =>
  transaction(
    Effect.gen(function* () {
      const repository = yield* UpvoteRepository;
      const activityRepository = yield* PostActivityRepository;

      // Votes need a user row, so shadow users are provisioned here for
      // email-only subjects.
      const subject = yield* resolveOnBehalfSubject({
        organizationId: args.organizationId,
        needsUser: true,
        subject: args.subject,
        action: "voter",
      });
      if (subject.userId === null) {
        return yield* new InvalidSubjectError({
          message: "The resolved customer has no account to vote as",
        });
      }

      const added = yield* repository.addAs({
        organizationId: args.organizationId,
        postId: args.postId,
        userId: subject.userId,
      });
      if (!added.added) {
        return { added: added.added, userId: subject.userId };
      }

      const onBehalfMetadata = toOnBehalfMetadata(subject);
      yield* activityRepository.create({
        organizationId: args.organizationId,
        postId: args.postId,
        actorId: args.actor.userId,
        actorMemberId: args.actor.memberId,
        kind: "VOTE_ADDED",
        ...(onBehalfMetadata && { metadata: onBehalfMetadata }),
      });

      // Adding a voter is an explicit admin statement that this person cares
      // about the post, so they get a post email subscription. Self-service
      // voting still subscribes nobody, and in-app notifications stay
      // member-only.
      const subscriptionNow = yield* DateTime.nowAsDate;
      yield* subscribeOnBehalfSubject({
        organizationId: args.organizationId,
        topicId: args.postId,
        subject,
        source: "admin_added_voter",
        subjectKind: "voter",
        now: subscriptionNow,
      });

      return { added: added.added, userId: subject.userId };
    })
  );

/**
 * Records the `VOTE_REMOVED` timeline entry for one voter, inside the caller's
 * transaction.
 *
 * The entry snapshots the voter's display name and address alongside the
 * documented `{ contactId, userId }` provenance: the contact can be deleted
 * later, and history that resolved its subject from a live collection would
 * then read "on behalf of a customer". `kind` marks a staff voter as staff so
 * losing their member row cannot relabel them. A voter whose account row no
 * longer resolves records identifiers only: the entry never asserts a class
 * it did not verify.
 */
export const recordVoteRemoved = (args: {
  readonly actor: VoteWriteActor;
  readonly organizationId: string;
  readonly postId: string;
  readonly userId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const activityRepository = yield* PostActivityRepository;

    // One round trip for every display fact the entry records. Reading the
    // contact in its own query missed members and account-only voters, whose
    // names would then vanish from history the moment the row changed.
    const [voter] = yield* db
      .select({
        contactEmail: schema.contactTable.email,
        contactId: schema.contactTable.id,
        contactName: schema.contactTable.name,
        memberId: schema.memberTable.id,
        userEmail: schema.userTable.email,
        userName: schema.userTable.name,
      })
      .from(schema.userTable)
      .leftJoin(
        schema.contactTable,
        and(
          eq(schema.contactTable.organizationId, args.organizationId),
          eq(schema.contactTable.userId, schema.userTable.id)
        )
      )
      .leftJoin(
        schema.memberTable,
        and(
          eq(schema.memberTable.organizationId, args.organizationId),
          eq(schema.memberTable.userId, schema.userTable.id)
        )
      )
      .where(eq(schema.userTable.id, args.userId))
      .limit(1);

    const contactId = voter?.contactId;
    const name = voter?.contactName ?? voter?.userName ?? null;
    // A shadow's synthetic inbox names nothing reachable, so it is never
    // stored as the voter's address.
    const email =
      voter?.contactEmail ??
      (voter && !isSyntheticEmail(voter.userEmail) ? voter.userEmail : null);

    yield* activityRepository.create({
      organizationId: args.organizationId,
      postId: args.postId,
      actorId: args.actor.userId,
      actorMemberId: args.actor.memberId,
      kind: "VOTE_REMOVED",
      metadata: {
        onBehalfOf: {
          ...(contactId != null && { contactId }),
          userId: args.userId,
          ...(name !== null && { name }),
          ...(email !== null && { email }),
          // The class is asserted only when the account row resolved. A vote's
          // `user_id` cascades with its account, so an unresolved row is not
          // reachable through the callers today — but if that ever changes,
          // the entry must not claim a class it did not verify.
          ...(voter && { kind: voter.memberId ? "member" : "customer" }),
        },
      },
    });
  });

/**
 * Removes exactly one voter's vote on behalf of the workspace, as one
 * transaction.
 *
 * Removing a non-voter is a success no-op that records nothing — the same
 * semantics as the dashboard's `RemoveUpvoteOnBehalf`. A removal records the
 * provenance `recordVoteRemoved` describes. Unsubscribing stays explicit:
 * removing a voter never touches their email subscription.
 */
export const removeVoteOnBehalf = (args: {
  readonly actor: VoteWriteActor;
  readonly organizationId: string;
  readonly postId: string;
  readonly userId: string;
}) =>
  transaction(
    Effect.gen(function* () {
      const repository = yield* UpvoteRepository;

      const removed = yield* repository.removeAs({
        organizationId: args.organizationId,
        postId: args.postId,
        userId: args.userId,
      });
      if (!removed.removed) {
        return removed;
      }

      yield* recordVoteRemoved(args);

      return removed;
    })
  );
