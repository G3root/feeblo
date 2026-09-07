import { currentDb, schema, transaction } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { InvalidSubjectError } from "../identity/errors";
import {
  resolveOnBehalfSubject,
  subscribeOnBehalfSubject,
  toOnBehalfMetadata,
} from "../identity/on-behalf";
import { ResolvePrincipalService } from "../identity/service";
import * as Policy from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { UserRepository } from "../user/repository";
import { UpvotePolicy } from "./policies";
import { UpvoteRepository } from "./repository";
import { UpvoteRpcs } from "./rpcs";
import type {
  TUpvoteAddOnBehalf,
  TUpvoteList,
  TUpvoteRemoveOnBehalf,
  TUpvoteToggle,
} from "./schema";

export const UpvoteRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* UpvoteRepository;
  const upvotePolicy = yield* UpvotePolicy;
  const activityRepository = yield* PostActivityRepository;
  const db = yield* currentDb;

  return {
    UpvoteList: (args: TUpvoteList) =>
      repository
        .list({
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(
            upvotePolicy.canList({
              organizationId: args.organizationId,
              source: "dashboard",
            })
          ),
          withRemapDbErrors("Upvote", "select")
        ),
    UpvoteToggle: (args: TUpvoteToggle) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const result = yield* transaction(
          repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          })
        );

        return result;
      }).pipe(
        Policy.withPolicy(
          upvotePolicy.canToggle({
            organizationId: args.organizationId,
            postId: args.postId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Upvote", "update")
      ),
    UpvoteAddOnBehalf: (args: TUpvoteAddOnBehalf) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        // Per-member abuse bound for on-behalf voter management (see
        // plan-on-behalf.md).
        yield* RateLimit.consumeOnBehalfWriteLimit({
          organizationId: args.organizationId,
          userId: session.session.userId,
        });

        const result = yield* transaction(
          Effect.gen(function* () {
            // The customer is resolved inside the same transaction as the
            // mutation (see plan-on-behalf.md). Votes need a user row, so
            // shadow users are provisioned here for email-only subjects.
            const subject = yield* resolveOnBehalfSubject({
              organizationId: args.organizationId,
              needsUser: true,
              subject: args.author,
              action: "voter",
            });
            if (subject.userId === null) {
              return yield* new InvalidSubjectError({
                message: "The resolved customer has no account to vote as",
              });
            }

            // Idempotent: an existing vote is a success no-op that records
            // no duplicate activity or subscription.
            const added = yield* repository.addAs({
              organizationId: args.organizationId,
              postId: args.postId,
              userId: subject.userId,
            });
            if (!added.added) {
              return added;
            }

            const onBehalfMetadata = toOnBehalfMetadata(subject);
            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "VOTE_ADDED",
              ...(onBehalfMetadata && { metadata: onBehalfMetadata }),
            });

            // Adding a voter is an explicit admin statement that this person
            // cares about the post, so they get a post email subscription.
            // Self-service voting still subscribes nobody, and in-app
            // notifications stay member-only.
            const subscriptionNow = yield* DateTime.nowAsDate;
            yield* subscribeOnBehalfSubject({
              organizationId: args.organizationId,
              topicId: args.postId,
              subject,
              source: "admin_added_voter",
              subjectKind: "voter",
              now: subscriptionNow,
            });

            return added;
          })
        );

        return result;
      }).pipe(
        Policy.withPolicy(
          upvotePolicy.canVoteOnBehalf({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
        withRemapDbErrors("Upvote", "update")
      ),
    UpvoteRemoveOnBehalf: (args: TUpvoteRemoveOnBehalf) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        // Same per-member bound as the add path (see plan-on-behalf.md).
        yield* RateLimit.consumeOnBehalfWriteLimit({
          organizationId: args.organizationId,
          userId: session.session.userId,
        });

        const result = yield* transaction(
          Effect.gen(function* () {
            // Removing a non-voter is a success no-op that records nothing.
            const removed = yield* repository.removeAs({
              organizationId: args.organizationId,
              postId: args.postId,
              userId: args.userId,
            });
            if (!removed.removed) {
              return removed;
            }

            // The remove payload carries only a userId; resolve the contact
            // when one exists so provenance keeps its documented
            // `{ contactId, userId }` shape. Pre-existing voters may have
            // no contact — then only the userId is recorded and nothing
            // is invented.
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
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "VOTE_REMOVED",
              metadata: {
                onBehalfOf: {
                  ...(voterContact && {
                    contactId: voterContact.contactId,
                  }),
                  userId: args.userId,
                },
              },
            });

            // Unsubscribing stays explicit: removing a voter never touches
            // their email subscription.
            return removed;
          })
        );

        return result;
      }).pipe(
        Policy.withPolicy(
          upvotePolicy.canVoteOnBehalf({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
        withRemapDbErrors("Upvote", "update")
      ),
    UpvoteListPublic: (args: TUpvoteList) =>
      Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        const sessionUserId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;

        const upvotes = yield* repository.list({
          organizationId: args.organizationId,
          publicOnly: true,
          ...(args.postId && { postId: args.postId }),
        });

        // Never leak internal voter identifiers to public callers.
        return redactActorIdentities(upvotes, sessionUserId);
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "UpvoteListPublic",
          level: "read",
        }),
        withRemapDbErrors("Upvote", "select")
      ),
    UpvoteTogglePublic: (args: TUpvoteToggle) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        // Public visibility is enforced via `upvotePolicy.canToggle` with
        // `source: "public"` (which checks `isUnlockedPublic` internally).
        const result = yield* transaction(
          repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          })
        );

        return result;
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "UpvoteTogglePublic",
          level: "write",
        }),
        Policy.withPolicy(
          upvotePolicy.canToggle({
            organizationId: args.organizationId,
            postId: args.postId,
            source: "public",
          })
        ),
        withRemapDbErrors("Upvote", "update")
      ),
  };
});

export const UpvoteRpcHandlers = UpvoteRpcs.toLayer(
  UpvoteRpcHandlersEffect
).pipe(
  Layer.provide(UpvotePolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(UpvoteRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(EmailSubscriptionRepository.layer),
  Layer.provide(ResolvePrincipalService.layer),
  Layer.provide(UserRepository.layer)
);
