import { currentDb, schema, transaction } from "@feeblo/db";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import {
  InvalidSubjectError,
  SubjectNotFoundError,
} from "../identity/errors";
import { isSyntheticEmail, ResolvePrincipalService } from "../identity/service";
import { PostActivityRepository } from "../post-activity/repository";
import * as Policy from "../policy";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
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

/** Verification links for admin-added voter subscriptions stay valid one day. */
const VERIFICATION_WINDOW_MS = 86_400_000;

export const UpvoteRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* UpvoteRepository;
  const upvotePolicy = yield* UpvotePolicy;
  const activityRepository = yield* PostActivityRepository;
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const resolvePrincipal = yield* ResolvePrincipalService;
  const userRepository = yield* UserRepository;
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

        const result = yield* transaction(
          Effect.gen(function* () {
            // The customer is resolved inside the same transaction as the
            // mutation (see plan-on-behalf.md). Votes need a user row, so
            // shadow users are provisioned here for email-only subjects.
            // Identity failures surface as themselves; infrastructure
            // failures are normalized like every other persistence error.
            const subject = yield* resolvePrincipal
              .resolve({
                organizationId: args.organizationId,
                needsUser: true,
                subject: args.author,
              })
              .pipe(
                Effect.mapError(
                  (
                    error,
                  ):
                    | SubjectNotFoundError
                    | InvalidSubjectError
                    | InternalServerError =>
                    error instanceof SubjectNotFoundError ||
                    error instanceof InvalidSubjectError
                      ? error
                      : new InternalServerError({
                          message: "Could not resolve the voter.",
                        })
                )
              );
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

            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "VOTE_ADDED",
              metadata: {
                onBehalfOf: {
                  contactId: subject.contactId,
                  userId: subject.userId,
                },
              },
            });

            // Adding a voter is an explicit admin statement that this person
            // cares about the post, so they get a post email subscription:
            // trusted/active when their linked account is email-verified,
            // deferred otherwise — nothing is emailed until identity linking
            // grants them access. Self-service voting still subscribes
            // nobody, and in-app notifications stay member-only.
            const subscriptionNow = yield* DateTime.nowAsDate;
            const subjectUser = yield* userRepository.getById(subject.userId);
            if (
              Option.isSome(subjectUser) &&
              subjectUser.value.emailVerified
            ) {
              yield* emailSubscriptions
                .requestSubscription({
                  alreadyVerifiedUser: { userId: subject.userId },
                  email: subjectUser.value.email,
                  now: subscriptionNow,
                  organizationId: args.organizationId,
                  source: "admin_added_voter",
                  topic: { topicId: args.postId, topicType: "post" },
                  verificationExpiresAt: new Date(
                    subscriptionNow.getTime() + VERIFICATION_WINDOW_MS
                  ),
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new InternalServerError({
                        message:
                          "Could not record the voter email subscription.",
                      })
                  )
                );
            } else {
              const [contact] = yield* db
                .select({ email: schema.contactTable.email })
                .from(schema.contactTable)
                .where(eq(schema.contactTable.id, subject.contactId))
                .limit(1);
              const contactEmail = contact?.email;
              if (
                contactEmail !== null &&
                contactEmail !== undefined &&
                !isSyntheticEmail(contactEmail)
              ) {
                yield* emailSubscriptions
                  .requestSubscription({
                    deferredNoAccess: true,
                    email: contactEmail,
                    now: subscriptionNow,
                    organizationId: args.organizationId,
                    source: "admin_added_voter",
                    topic: { topicId: args.postId, topicType: "post" },
                    verificationExpiresAt: new Date(
                      subscriptionNow.getTime() + VERIFICATION_WINDOW_MS
                    ),
                  })
                  .pipe(
                    Effect.mapError(
                      () =>
                        new InternalServerError({
                          message:
                            "Could not record the deferred voter email subscription.",
                        })
                    )
                  );
              }
            }

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

            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "VOTE_REMOVED",
              metadata: {
                onBehalfOf: {
                  // The remove payload carries only a userId; there may be
                  // no contact for pre-existing voters, so no contactId is
                  // invented here.
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
