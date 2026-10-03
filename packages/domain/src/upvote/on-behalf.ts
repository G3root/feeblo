import { currentDb, schema, transaction } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

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
 * This is the dashboard's `UpvoteAddOnBehalf` body and the Public API's
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
 * Removes exactly one voter's vote on behalf of the workspace, as one
 * transaction.
 *
 * Removing a non-voter is a success no-op that records nothing — the same
 * semantics as the dashboard's `UpvoteRemoveOnBehalf`. When a vote is actually
 * removed the timeline entry keeps its documented `{ contactId, userId }`
 * provenance shape: the contact is resolved when the voter has one, and
 * pre-existing voters with no contact record only the account id, because
 * nothing is invented. Unsubscribing stays explicit: removing a voter never
 * touches their email subscription.
 */
export const removeVoteOnBehalf = (args: {
  readonly actor: VoteWriteActor;
  readonly organizationId: string;
  readonly postId: string;
  readonly userId: string;
}) =>
  transaction(
    Effect.gen(function* () {
      const db = yield* currentDb;
      const repository = yield* UpvoteRepository;
      const activityRepository = yield* PostActivityRepository;

      const removed = yield* repository.removeAs({
        organizationId: args.organizationId,
        postId: args.postId,
        userId: args.userId,
      });
      if (!removed.removed) {
        return removed;
      }

      const [voterContact] = yield* db
        .select({ contactId: schema.contactTable.id })
        .from(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.organizationId, args.organizationId),
            eq(schema.contactTable.userId, args.userId)
          )
        )
        .limit(1);

      yield* activityRepository.create({
        organizationId: args.organizationId,
        postId: args.postId,
        actorId: args.actor.userId,
        actorMemberId: args.actor.memberId,
        kind: "VOTE_REMOVED",
        metadata: {
          onBehalfOf: {
            ...(voterContact && { contactId: voterContact.contactId }),
            userId: args.userId,
          },
        },
      });

      return removed;
    })
  );
