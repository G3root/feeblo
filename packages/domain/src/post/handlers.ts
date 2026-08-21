import { currentDb, schema, transaction } from "@feeblo/db";
import { type LegidOf, PostStatusId } from "@feeblo/id";
import * as Permissions from "@feeblo/permissions";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  cleanupOrphanedEditorAssets,
  cleanupPreparedEditorAssets,
  commitPreparedEditorAssets,
  prepareEditorAssetContent,
  rollbackPreparedEditorAssets,
  syncPostAssetReferences,
} from "../asset/service";
import { BoardRepository } from "../board/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { wakeEmailOutboxBestEffort } from "../email-outbox/workflow";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import {
  InvalidSubjectError,
  SubjectNotFoundError,
} from "../identity/errors";
import { isSyntheticEmail, ResolvePrincipalService } from "../identity/service";
import { recordPostIntegrationEvent as recordPostIntegrationEventShared } from "../integration/post-event-recording";
import { NotificationService } from "../notification/service";
import * as Policy from "../policy";
import {
  type PostActivityInput,
  type PostActivityMetadata,
  PostActivityRepository,
} from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import * as RateLimit from "../rate-limit";
import {
  BadRequestError,
  InternalServerError,
  withRemapDbErrors,
} from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { UserRepository } from "../user/repository";
import { WorkspaceRepository } from "../workspace/repository";
import {
  PostEmbeddingService,
  postEmbeddingInput,
  schedulePostEmbeddingBestEffort,
} from "./embedding-service";
import { FailedToUpdatePostError, PostAlreadyExistsError } from "./errors";
import { PostPolicy } from "./policies";
import { PostRepository } from "./repository";
import { PostRpcs } from "./rpcs";
import type {
  TPostAdminUpdate,
  TPostCreate,
  TPostDelete,
  TPostList,
  TPostMerge,
  TPostOfficialUpdatePublish,
  TPostSuggestions,
  TPostUpdate,
  TPostUpdateContent,
  TPostUpdateEta,
  TPostUpdateTitle,
} from "./schema";
import { postLexicalSimilarity, SUGGESTION_MAX_DISTANCE } from "./suggestions";

const postStatusCoalescingDelayMs = 5 * 60 * 1000;

export const PostRpcHandlersEffect = Effect.gen(function* () {
  const boardRepository = yield* BoardRepository;
  const db = yield* currentDb;
  const repository = yield* PostRepository;
  const emailOutbox = yield* EmailOutboxRepository;
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const activityRepository = yield* PostActivityRepository;
  const postPolicy = yield* PostPolicy;
  const resolvePrincipal = yield* ResolvePrincipalService;
  const userRepository = yield* UserRepository;
  const notifications = yield* Effect.serviceOption(NotificationService);
  const embeddingService = yield* Effect.serviceOption(PostEmbeddingService);
  // const sitePolicy = yield* SitePolicy;

  // -- Shared effect helpers (no policy applied) --

  // Post-handler adapter over the shared integration event recorder: converts
  // the session actor facts into the safe actor shape and keeps the handler's
  // existing failure classification (lookup problems are update failures,
  // recording problems are internal errors).
  const recordPostIntegrationEvent = ({
    actorMemberId,
    actorName,
    boardId,
    description,
    eventType,
    organizationId,
    postId,
    postSlug,
    previousStatusId,
    statusId,
    title,
  }: {
    actorMemberId: string | null;
    actorName: string | null | undefined;
    boardId: LegidOf<"BoardId">;
    description?: string;
    eventType: "feedback.post.created" | "feedback.post.status_changed";
    organizationId: LegidOf<"WorkspaceId">;
    postId: LegidOf<"PostId">;
    postSlug: string;
    previousStatusId?: LegidOf<"PostStatusId">;
    statusId: LegidOf<"PostStatusId">;
    title: string;
  }) =>
    recordPostIntegrationEventShared({
      actor:
        actorMemberId === null
          ? { kind: "end_user" }
          : {
              ...(actorName !== undefined &&
                actorName !== null && { displayName: actorName }),
              kind: "member",
              memberId: actorMemberId,
            },
      boardId,
      ...(description !== undefined && { description }),
      eventType,
      organizationId,
      postId,
      postSlug,
      ...(previousStatusId !== undefined && { previousStatusId }),
      statusId,
      title,
    }).pipe(
      Effect.mapError((error) =>
        error.kind === "lookup"
          ? new FailedToUpdatePostError()
          : new InternalServerError({
              message: "Could not record integration event.",
            })
      )
    );

  const scheduleEmbedding = ({
    content,
    id,
    organizationId,
    title,
  }: {
    content: string;
    id: string;
    organizationId: string;
    title: string;
  }) =>
    Option.match(embeddingService, {
      onNone: () => Effect.void,
      onSome: (service) =>
        schedulePostEmbeddingBestEffort({
          content,
          embeddingService: service,
          postId: id,
          organizationId,
          title,
        }),
    });

  const suggestionsEffect = (args: TPostSuggestions, publicOnly: boolean) =>
    Effect.gen(function* () {
      const input = postEmbeddingInput(args);
      const resultLimit = args.limit ?? 5;
      const queryEmbedding = Option.isSome(embeddingService)
        ? yield* embeddingService.value
            .embed(input)
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning(
                  "Failed to generate suggestion query embedding",
                  cause
                ).pipe(Effect.as(Option.none()))
              )
            )
        : Option.none();
      const candidates = yield* repository.findSuggestionCandidates({
        organizationId: args.organizationId,
        ...(args.boardId && { boardId: args.boardId }),
        ...(Option.isSome(queryEmbedding) && {
          embedding: queryEmbedding.value.vector,
          embeddingModel: queryEmbedding.value.model,
        }),
        limit: Option.isSome(queryEmbedding)
          ? resultLimit
          : Math.max(25, resultLimit * 5),
        publicOnly,
      });

      if (Option.isSome(queryEmbedding)) {
        const matches = candidates
          .filter(
            (candidate) =>
              candidate.distance !== null &&
              candidate.distance <= SUGGESTION_MAX_DISTANCE
          )
          .map(({ distance: _distance, ...post }) => post);
        if (matches.length > 0) {
          return matches;
        }
      }

      const lexicalCandidates = Option.isSome(queryEmbedding)
        ? yield* repository.findSuggestionCandidates({
            organizationId: args.organizationId,
            ...(args.boardId && { boardId: args.boardId }),
            limit: Math.max(25, resultLimit * 5),
            publicOnly,
          })
        : candidates;

      return lexicalCandidates
        .map((post) => ({
          post,
          score: postLexicalSimilarity(input, post),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, resultLimit)
        .map(({ post }) => post);
    });

  const deletePostEffect = (args: TPostDelete) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const canDeleteEngagedPost = Permissions.can(
        session,
        args.organizationId,
        "posts.*"
      );
      const deleted = yield* transaction(
        repository.delete({
          id: args.id,
          organizationId: args.organizationId,
          boardId: args.boardId,
          creatorId: session.session.userId,
          onlyIfNew: !canDeleteEngagedPost,
        })
      );

      if (!(deleted || canDeleteEngagedPost)) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Posts with comments or other users' votes cannot be deleted",
        });
      }

      return undefined;
    }).pipe(
      Effect.tap(() =>
        cleanupOrphanedEditorAssets({
          organizationId: args.organizationId,
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning(
              "Failed to clean up orphaned editor assets",
              cause
            ).pipe(Effect.annotateLogs({ organizationId: args.organizationId }))
          )
        )
      )
    );

  const updatePostEffect = (args: TPostUpdate) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);
      const outboxId = yield* transaction(
        Effect.gen(function* () {
          const previous = yield* repository.findActivityState({
            id: args.id,
            organizationId: args.organizationId,
          });
          if (!previous) {
            return yield* new FailedToUpdatePostError();
          }
          const actor = {
            actorId: session.session.userId,
            actorMemberId: membership?.membershipId ?? null,
            organizationId: args.organizationId,
            postId: args.id,
          };
          const activities: PostActivityInput[] = [];
          if (previous.statusId !== args.statusId) {
            activities.push({
              ...actor,
              kind: "STATUS_CHANGED",
              previousStatusId: previous.statusId,
              nextStatusId: args.statusId,
            });
          }
          if (previous.boardId !== args.boardId) {
            activities.push({
              ...actor,
              kind: "BOARD_CHANGED",
              previousBoardId: previous.boardId,
              nextBoardId: args.boardId,
            });
          }
          yield* repository.update(args);
          yield* activityRepository.createMany(activities);
          let createdOutboxId: string | undefined;
          if (previous.statusId !== args.statusId) {
            const postRows = yield* db
              .select({ slug: schema.postTable.slug })
              .from(schema.postTable)
              .where(
                and(
                  eq(schema.postTable.id, args.id),
                  eq(schema.postTable.organizationId, args.organizationId)
                )
              )
              .limit(1);
            const postSlug = postRows[0]?.slug;
            if (!postSlug) {
              return yield* new FailedToUpdatePostError();
            }
            yield* recordPostIntegrationEvent({
              actorMemberId: membership?.membershipId ?? null,
              actorName: membership ? session.user.name : undefined,
              boardId: args.boardId,
              eventType: "feedback.post.status_changed",
              organizationId: args.organizationId,
              postId: args.id,
              postSlug,
              previousStatusId: yield* PostStatusId.parse(previous.statusId),
              statusId: args.statusId,
              title: previous.title,
            });
            const maySend = yield* entitlementPolicy.mayMaterializeEmailIntent({
              organizationId: args.organizationId,
              kind: "post.status_changed",
            });
            if (maySend) {
              const now = yield* DateTime.nowAsDate;
              const statusType = yield* repository.findStatusType({
                id: args.statusId,
                organizationId: args.organizationId,
              });
              if (statusType === "CLOSED") {
                const result = yield* emailOutbox
                  .recordIntent({
                    aggregateId: args.id,
                    aggregateType: "post",
                    deduplicationKey: `post.closed:${args.organizationId}:${args.id}:${args.statusId}`,
                    expiresAt: new Date(now.getTime() + 7 * 86_400_000),
                    kind: "post.closed",
                    organizationId: args.organizationId,
                    payload: { kind: "post.closed", postId: args.id },
                    scheduledAt: now,
                  })
                  .pipe(
                    Effect.mapError(
                      () =>
                        new InternalServerError({
                          message:
                            "Could not record post closure email intent.",
                        })
                    )
                  );
                createdOutboxId =
                  result._tag === "Inserted" ? result.intent.id : undefined;
              } else {
                const result = yield* emailOutbox
                  .upsertPendingStatusChange({
                    aggregateId: args.id,
                    aggregateType: "post",
                    deduplicationKey: `post.status_changed:${args.organizationId}:${args.id}:${now.getTime()}`,
                    expiresAt: new Date(
                      now.getTime() +
                        postStatusCoalescingDelayMs +
                        7 * 86_400_000
                    ),
                    organizationId: args.organizationId,
                    payload: {
                      kind: "post.status_changed",
                      postId: args.id,
                      statusId: args.statusId,
                    },
                    scheduledAt: new Date(
                      now.getTime() + postStatusCoalescingDelayMs
                    ),
                  })
                  .pipe(
                    Effect.mapError(
                      () =>
                        new InternalServerError({
                          message: "Could not record post status email intent.",
                        })
                    )
                  );
                createdOutboxId =
                  result._tag === "Written" ? result.intent.id : undefined;
              }
            }
            yield* Option.match(notifications, {
              onNone: () => Effect.void,
              onSome: (service) =>
                service.notifyPostStatusChanged({
                  organizationId: args.organizationId,
                  postId: args.id,
                  ...(membership && {
                    actorMemberId: membership.membershipId,
                  }),
                }),
            });
          }
          return createdOutboxId;
        })
      );
      yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
    });

  const updatePostEtaEffect = (args: TPostUpdateEta) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);
      yield* transaction(
        Effect.gen(function* () {
          const previous = yield* repository.findActivityState({
            id: args.id,
            organizationId: args.organizationId,
          });
          if (!previous) {
            return yield* new FailedToUpdatePostError();
          }
          if (previous.etaQuarter === args.etaQuarter) {
            return;
          }
          yield* repository.updateEta({
            id: args.id,
            organizationId: args.organizationId,
            etaQuarter: args.etaQuarter,
          });
          yield* activityRepository.create({
            actorId: session.session.userId,
            actorMemberId: membership?.membershipId ?? null,
            organizationId: args.organizationId,
            postId: args.id,
            kind: "ETA_CHANGED",
            previousEta: previous.etaQuarter,
            nextEta: args.etaQuarter,
          });
        })
      );
    });

  const updatePostContentEffect = (args: TPostUpdateContent) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
        args.content
      );
      const prepared = yield* prepareEditorAssetContent({
        organizationId: args.organizationId,
        userId: session.session.userId,
        content: sanitizedMarkdown,
        assetIds: args.assetIds,
      });
      const membership = Policy.getMembership(session, args.organizationId);
      let contentChanged = false;
      let title = "";
      yield* transaction(
        Effect.gen(function* () {
          const previous = yield* repository.findActivityState({
            id: args.id,
            organizationId: args.organizationId,
          });
          if (!previous) {
            return yield* new FailedToUpdatePostError();
          }
          title = previous.title;
          contentChanged = previous.content !== prepared.content;
          if (!contentChanged) {
            yield* commitPreparedEditorAssets(prepared.promotions);
            yield* syncPostAssetReferences({
              postId: args.id,
              organizationId: args.organizationId,
              userId: session.session.userId,
              content: prepared.content,
              assetIds: args.assetIds,
            });
            return;
          }
          const actor = {
            actorId: session.session.userId,
            actorMemberId: membership?.membershipId ?? null,
            organizationId: args.organizationId,
            postId: args.id,
          };
          yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            content: prepared.content,
            excerpt: htmlToExcerpt(sanitizedHtml),
          });
          yield* commitPreparedEditorAssets(prepared.promotions);
          yield* syncPostAssetReferences({
            postId: args.id,
            organizationId: args.organizationId,
            userId: session.session.userId,
            content: prepared.content,
            assetIds: args.assetIds,
          });
          yield* activityRepository.create({
            ...actor,
            kind: "CONTENT_CHANGED",
          });
        })
      ).pipe(
        Effect.tapCause(() =>
          rollbackPreparedEditorAssets(prepared.promotions)
        ),
        Effect.ensuring(cleanupPreparedEditorAssets(prepared.promotions))
      );
      if (contentChanged) {
        yield* scheduleEmbedding({
          content: prepared.content,
          id: args.id,
          organizationId: args.organizationId,
          title,
        });
      }
    });

  const updatePostTitleEffect = (args: TPostUpdateTitle) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);
      let titleChanged = false;
      let content = "";
      yield* transaction(
        Effect.gen(function* () {
          const previous = yield* repository.findActivityState({
            id: args.id,
            organizationId: args.organizationId,
          });
          if (!previous) {
            return yield* new FailedToUpdatePostError();
          }
          content = previous.content;
          titleChanged = previous.title !== args.title;
          if (!titleChanged) {
            return;
          }
          const actor = {
            actorId: session.session.userId,
            actorMemberId: membership?.membershipId ?? null,
            organizationId: args.organizationId,
            postId: args.id,
          };
          yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            title: args.title,
          });
          yield* activityRepository.create({
            ...actor,
            kind: "TITLE_CHANGED",
            previousTitle: previous.title,
            nextTitle: args.title,
          });
        })
      );
      if (titleChanged) {
        yield* scheduleEmbedding({
          content,
          id: args.id,
          organizationId: args.organizationId,
          title: args.title,
        });
      }
    });

  const createPostEffect = (
    args: TPostCreate,
    opts: { source?: "PUBLIC_BOARD" } = {}
  ) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);
      const subscriptionRepository = yield* PostSubscriptionRepository;
      const board = yield* boardRepository.getById({
        id: args.boardId,
        organizationId: args.organizationId,
      });

      if (board._tag === "None") {
        return yield* new Policy.PolicyDeniedError({
          reason: "You are not allowed to post to this board.",
        });
      }

      if (!membership && board.value.visibility !== "PUBLIC") {
        return yield* new Policy.PolicyDeniedError({
          reason: "You are not allowed to post to this board.",
        });
      }

      const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
        args.content
      );
      const prepared = yield* prepareEditorAssetContent({
        organizationId: args.organizationId,
        userId: session.session.userId,
        content: sanitizedMarkdown,
        assetIds: args.assetIds,
      });

      const persisted = yield* transaction(
        Effect.gen(function* () {
          // On-behalf attribution resolves the customer inside the same
          // transaction as the mutation (see plan-on-behalf.md). Absent
          // `author`, everything below behaves exactly as before. Identity
          // failures surface as themselves; infrastructure failures are
          // normalized like every other subscription/persistence error here.
          const subject =
            args.author === undefined
              ? undefined
              : yield* resolvePrincipal
                  .resolve({
                    organizationId: args.organizationId,
                    needsUser: false,
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
                              message:
                                "Could not resolve the post author.",
                            })
                    )
                  );
          const onBehalfMetadata: PostActivityMetadata | undefined =
            subject && {
              onBehalfOf: {
                contactId: subject.contactId,
                ...(subject.userId !== null && { userId: subject.userId }),
              },
            };
          const persistedSlug = yield* repository.create({
            ...args,
            content: prepared.content,
            excerpt: htmlToExcerpt(sanitizedHtml),
            creatorId: subject ? subject.userId : session.session.userId,
            ...(opts.source && { source: opts.source }),
            // On-behalf posts keep staff attribution out of the author fields.
            ...(membership &&
              !subject && { creatorMemberId: membership.membershipId }),
            ...(subject && { contactId: subject.contactId }),
          });
          yield* commitPreparedEditorAssets(prepared.promotions);
          yield* syncPostAssetReferences({
            postId: args.id,
            organizationId: args.organizationId,
            userId: session.session.userId,
            content: prepared.content,
            assetIds: args.assetIds,
          });

          yield* activityRepository.create({
            organizationId: args.organizationId,
            postId: args.id,
            actorId: session.session.userId,
            actorMemberId: membership?.membershipId ?? null,
            kind: "POST_CREATED",
            ...(onBehalfMetadata && { metadata: onBehalfMetadata }),
          });
          yield* recordPostIntegrationEvent({
            actorMemberId: membership?.membershipId ?? null,
            actorName: membership ? session.user.name : undefined,
            boardId: args.boardId,
            description: prepared.content,
            eventType: "feedback.post.created",
            organizationId: args.organizationId,
            postId: args.id,
            postSlug: persistedSlug,
            statusId: args.statusId,
            title: args.title,
          });

          // The creator of a post is automatically subscribed to it.
          // On-behalf posts subscribe the resolved customer instead of the
          // staff actor, following the same notification-eligibility rules:
          // a verified account is trusted, everyone else is deferred until
          // identity linking grants them access.
          const subscriptionNow = yield* DateTime.nowAsDate;
          if (subject === undefined) {
            yield* subscriptionRepository.subscribe({
              organizationId: args.organizationId,
              postId: args.id,
              userId: session.session.userId,
              ...(membership && { memberId: membership.membershipId }),
            });
            yield* emailSubscriptions
              .requestSubscription({
                alreadyVerifiedUser: { userId: session.session.userId },
                email: session.user.email,
                now: subscriptionNow,
                organizationId: args.organizationId,
                source: "post_creator",
                topic: { topicId: args.id, topicType: "post" },
                verificationExpiresAt: new Date(
                  subscriptionNow.getTime() + 86_400_000
                ),
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new InternalServerError({
                      message:
                        "Could not record the post creator email subscription.",
                    })
                )
              );
          } else {
            const subjectUser =
              subject.userId === null
                ? Option.none()
                : yield* userRepository.getById(subject.userId);
            const verifiedEmail =
              Option.isSome(subjectUser) && subjectUser.value.emailVerified
                ? subjectUser.value.email
                : undefined;

            // In-app watch-list parity for the attributed author.
            if (subject.userId !== null) {
              yield* subscriptionRepository.subscribe({
                organizationId: args.organizationId,
                postId: args.id,
                userId: subject.userId,
              });
            }

            if (verifiedEmail !== undefined && subject.userId !== null) {
              yield* emailSubscriptions
                .requestSubscription({
                  alreadyVerifiedUser: { userId: subject.userId },
                  email: verifiedEmail,
                  now: subscriptionNow,
                  organizationId: args.organizationId,
                  source: "post_creator",
                  topic: { topicId: args.id, topicType: "post" },
                  verificationExpiresAt: new Date(
                    subscriptionNow.getTime() + 86_400_000
                  ),
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new InternalServerError({
                        message:
                          "Could not record the post author email subscription.",
                      })
                  )
                );
            } else {
              // Deferred: the subject has no verified account, so nothing is
              // emailed — not even a verification request — until identity
              // linking activates the subscription.
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
                    source: "post_creator",
                    topic: { topicId: args.id, topicType: "post" },
                    verificationExpiresAt: new Date(
                      subscriptionNow.getTime() + 86_400_000
                    ),
                  })
                  .pipe(
                    Effect.mapError(
                      () =>
                        new InternalServerError({
                          message:
                            "Could not record the deferred post author email subscription.",
                        })
                    )
                  );
              }
            }
          }

          const intent = yield* emailOutbox
            .recordIntent({
              aggregateId: args.id,
              aggregateType: "post",
              deduplicationKey: `submission.created:${args.organizationId}:${args.id}`,
              expiresAt: null,
              kind: "submission.created",
              organizationId: args.organizationId,
              payload: { kind: "submission.created", postId: args.id },
              scheduledAt: subscriptionNow,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({
                    message: "Could not record submission email intent.",
                  })
              )
            );
          yield* Option.match(notifications, {
            onNone: () => Effect.void,
            onSome: (service) =>
              service.notifySubmission({
                organizationId: args.organizationId,
                postId: args.id,
                ...(membership && {
                  actorMemberId: membership.membershipId,
                }),
              }),
          });

          return {
            slug: persistedSlug,
            outboxId: intent._tag === "Inserted" ? intent.intent.id : undefined,
          };
        })
      ).pipe(
        Effect.tapCause(() =>
          rollbackPreparedEditorAssets(prepared.promotions)
        ),
        Effect.ensuring(cleanupPreparedEditorAssets(prepared.promotions))
      );

      yield* wakeEmailOutboxBestEffort(persisted.outboxId, args.organizationId);
      yield* scheduleEmbedding({
        content: prepared.content,
        id: args.id,
        organizationId: args.organizationId,
        title: args.title,
      });

      // The slug actually persisted by the insert (including any collision
      // suffix) so callers can reference the stored post.
      return persisted.slug;
    });

  // -- RPC handlers --

  return {
    PostList: (args: TPostList) => {
      return Effect.gen(function* () {
        const session = yield* CurrentSession;
        return yield* repository.findMany({
          organizationId: args.organizationId,
          boardId: args.boardId,
          userId: session.session.userId,
        });
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Post", "select")
      );
    },

    PostListPublic: (args: TPostList) => {
      return Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        const userId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;
        // Public post listing is intentionally unauthenticated; board
        // visibility is enforced inside `findManyPublic` (unlocked boards
        // only). No site-policy gate needed here.
        return yield* repository.findManyPublic({
          organizationId: args.organizationId,
          boardId: args.boardId,
          userId,
        });
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostListPublic",
          level: "read",
        }),
        withRemapDbErrors("Post", "select")
      );
    },

    PostSuggestions: (args: TPostSuggestions) =>
      suggestionsEffect(args, false).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Post", "select")
      ),

    PostSuggestionsPublic: (args: TPostSuggestions) =>
      suggestionsEffect(args, true).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostSuggestionsPublic",
          level: "read",
        }),
        withRemapDbErrors("Post", "select")
      ),

    PostDelete: (args: TPostDelete) =>
      deletePostEffect(args).pipe(
        Policy.withPolicy(
          postPolicy.canDelete({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Post", "delete")
      ),

    PostDeletePublic: (args: TPostDelete) =>
      deletePostEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostDeletePublic",
          level: "write",
        }),
        Policy.withPolicy(
          postPolicy.canDelete({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            source: "public",
          })
        ),
        withRemapDbErrors("Post", "delete")
      ),

    PostUpdate: (args: TPostUpdate) =>
      updatePostEffect(args).pipe(
        Policy.withPolicy(
          postPolicy.canUpdateProperties({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            statusId: args.statusId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostUpdatePublic: (args: TPostUpdate) =>
      updatePostEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostUpdatePublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          postPolicy.canUpdate({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            source: "public",
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostUpdateContent: (args: TPostUpdateContent) =>
      updatePostContentEffect(args).pipe(
        Policy.withPolicy(
          postPolicy.canUpdate({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostUpdateTitle: (args: TPostUpdateTitle) =>
      updatePostTitleEffect(args).pipe(
        Policy.withPolicy(
          postPolicy.canUpdate({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostUpdateContentPublic: (args: TPostUpdateContent) =>
      updatePostContentEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostUpdateContentPublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          postPolicy.canUpdate({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            source: "public",
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostUpdateTitlePublic: (args: TPostUpdateTitle) =>
      updatePostTitleEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostUpdateTitlePublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          postPolicy.canUpdate({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            source: "public",
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostCreate: (args: TPostCreate) =>
      createPostEffect(args).pipe(
        Policy.withPolicy(
          postPolicy.canCreate({
            organizationId: args.organizationId,
            onBehalf: args.author !== undefined,
            source: "dashboard",
          })
        ),
        withRemapDbErrors({
          action: "create",
          entity: "Post",
          onUniqueViolation: () =>
            new PostAlreadyExistsError({
              message: "A post with this slug already exists",
            }),
        })
      ),

    PostCreatePublic: (args: TPostCreate) =>
      Effect.gen(function* () {
        if (args.author !== undefined) {
          return yield* new BadRequestError({
            message:
              "Posts cannot be created on behalf of another author from public boards",
          });
        }
        return yield* createPostEffect(args, { source: "PUBLIC_BOARD" });
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostCreatePublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          postPolicy.canCreate({
            organizationId: args.organizationId,
            source: "public",
          })
        ),
        withRemapDbErrors({
          action: "create",
          entity: "Post",
          onUniqueViolation: () =>
            new PostAlreadyExistsError({
              message: "A post with this slug already exists",
            }),
        })
      ),

    PostUpdateEta: (args: TPostUpdateEta) =>
      updatePostEtaEffect(args).pipe(
        Policy.withPolicy(postPolicy.canUpdateEta(args.organizationId)),
        withRemapDbErrors("Post", "update")
      ),

    PostAdminUpdate: (args: TPostAdminUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        yield* transaction(
          Effect.gen(function* () {
            const previous = yield* repository.findActivityState({
              id: args.id,
              organizationId: args.organizationId,
            });
            if (!previous) {
              return yield* new FailedToUpdatePostError();
            }
            const actor = {
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              organizationId: args.organizationId,
              postId: args.id,
            };
            const activities: PostActivityInput[] = [];
            if (
              args.locked !== undefined &&
              Boolean(previous.lockedAt) !== args.locked
            ) {
              activities.push({
                ...actor,
                kind: args.locked ? "POST_LOCKED" : "POST_UNLOCKED",
              });
            }
            if (
              args.archived !== undefined &&
              Boolean(previous.archivedAt) !== args.archived
            ) {
              activities.push({
                ...actor,
                kind: args.archived ? "POST_ARCHIVED" : "POST_UNARCHIVED",
              });
            }
            yield* repository.adminUpdate(args);
            yield* activityRepository.createMany(activities);
          })
        );
      }).pipe(
        Policy.withPolicy(postPolicy.canAdminUpdate(args.organizationId)),
        withRemapDbErrors("Post", "update")
      ),

    PostOfficialUpdatePublish: (args: TPostOfficialUpdatePublish) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const now = yield* DateTime.nowAsDate;
        const outboxId = yield* transaction(
          Effect.gen(function* () {
            const post = yield* repository.findActivityState({
              id: args.postId,
              organizationId: args.organizationId,
            });
            if (post === undefined) {
              return yield* new FailedToUpdatePostError();
            }
            yield* activityRepository.create({
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              id: args.updateId,
              kind: "OFFICIAL_UPDATE_PUBLISHED",
              body: args.body,
              organizationId: args.organizationId,
              postId: args.postId,
            });
            if (
              !(yield* entitlementPolicy.mayMaterializeEmailIntent({
                organizationId: args.organizationId,
                kind: "post.official_update_published",
              }))
            ) {
              return undefined;
            }
            const recorded = yield* emailOutbox
              .recordIntent({
                aggregateId: args.postId,
                aggregateType: "post",
                deduplicationKey: `post.official_update_published:${args.updateId}`,
                expiresAt: new Date(now.getTime() + 7 * 86_400_000),
                kind: "post.official_update_published",
                organizationId: args.organizationId,
                payload: {
                  body: args.body,
                  kind: "post.official_update_published",
                  postId: args.postId,
                  updateId: args.updateId,
                },
                scheduledAt: now,
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new InternalServerError({
                      message: "Could not record official update email intent.",
                    })
                )
              );
            return recorded._tag === "Inserted"
              ? recorded.intent.id
              : undefined;
          })
        );
        yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
      }).pipe(
        Policy.withPolicy(postPolicy.canAdminUpdate(args.organizationId)),
        withRemapDbErrors("Post", "update")
      ),

    PostMerge: (args: TPostMerge) =>
      Effect.gen(function* () {
        if (args.sourcePostId === args.targetPostId) {
          return yield* new BadRequestError({
            message: "Source and target posts must be different",
          });
        }
        const outboxId = yield* transaction(
          Effect.gen(function* () {
            yield* repository.merge(args);
            if (
              !(yield* entitlementPolicy.mayMaterializeEmailIntent({
                organizationId: args.organizationId,
                kind: "post.merged",
              }))
            ) {
              return undefined;
            }
            const now = yield* DateTime.nowAsDate;
            const result = yield* emailOutbox
              .recordIntent({
                aggregateId: args.sourcePostId,
                aggregateType: "post",
                deduplicationKey: `post.merged:${args.organizationId}:${args.sourcePostId}:${args.targetPostId}`,
                expiresAt: new Date(now.getTime() + 7 * 86_400_000),
                kind: "post.merged",
                organizationId: args.organizationId,
                payload: {
                  kind: "post.merged",
                  postId: args.sourcePostId,
                  targetPostId: args.targetPostId,
                },
                scheduledAt: now,
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new InternalServerError({
                      message: "Could not record post merge email intent.",
                    })
                )
              );
            return result._tag === "Inserted" ? result.intent.id : undefined;
          })
        );
        yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
      }).pipe(
        Policy.withPolicy(postPolicy.canMerge(args.organizationId)),
        withRemapDbErrors("Post", "update")
      ),
  };
});

export const PostRpcHandlers = PostRpcs.toLayer(PostRpcHandlersEffect).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(BoardRepository.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(PostSubscriptionRepository.layer),
  Layer.provide(EmailOutboxRepository.layer),
  Layer.provide(EmailSubscriptionRepository.layer),
  Layer.provide(EmailOutboxConfig.layer),
  Layer.provide(ResolvePrincipalService.layer),
  Layer.provide(UserRepository.layer),
  Layer.provide(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  ),
  Layer.provide(PostEmbeddingService.layer),
  Layer.provide(NotificationService.layer)
);
