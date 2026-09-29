import { transaction } from "@feeblo/db";
import { BoardId, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import {
  cleanupOrphanedEditorAssets,
  cleanupPreparedEditorAssets,
  commitPreparedEditorAssets,
  prepareEditorAssetContent,
  rollbackPreparedEditorAssets,
  syncPostAssetReferences,
} from "../asset/service";
import { BoardRepository } from "../board/repository";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { wakeEmailOutboxBestEffort } from "../email-outbox/workflow";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import {
  resolveOnBehalfSubject,
  subscribeOnBehalfSubject,
  toOnBehalfMetadata,
} from "../identity/on-behalf";
import { recordPostIntegrationEvent as recordPostIntegrationEventShared } from "../integration/post-event-recording";
import { NotificationService } from "../notification/service";
import * as Policy from "../policy";
import {
  type PostActivityInput,
  PostActivityRepository,
} from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import * as RateLimit from "../rate-limit";
import { BadRequestError, InternalServerError } from "../rpc-errors";
import {
  PostEmbeddingService,
  schedulePostEmbeddingBestEffort,
} from "./embedding-service";
import { FailedToUpdatePostError, PostNotFoundError } from "./errors";
import { PostRepository } from "./repository";

const postStatusCoalescingDelayMs = 5 * 60 * 1000;

/**
 * The customer a dashboard write is attributed to.
 *
 * Structurally the RPC payload's `PostCreateAuthor`, restated rather than
 * imported so the shared write path does not depend on the dashboard's request
 * schema — a field added there must not silently become accepted here.
 */
export type PostWriteAuthor = {
  readonly avatarUrl?: string | undefined;
  readonly contactId?: string | undefined;
  readonly email?: string | undefined;
  readonly externalId?: string | undefined;
  readonly name?: string | undefined;
  readonly userId?: string | undefined;
};

/**
 * Who is performing a post write.
 *
 * A member carries a person: the actor columns on the post's timeline, the
 * subscription created for the post's author, and the name an integration event
 * attributes the change to. A machine key carries none of those, and the write
 * path treats every person-shaped side effect as something to skip rather than
 * invent — the same convention the changelog publication and the tag writes
 * already follow.
 *
 * The actor is a parameter rather than a `CurrentSession` context read because
 * the Public API cannot resolve one: a machine key must never become a member
 * (ADR 0003), and a shared write that read the session would drag the session
 * middleware into the public module.
 */
export type PostWriteActor =
  | {
      readonly email: string;
      readonly kind: "member";
      readonly memberId: string | null;
      readonly name: string | null | undefined;
      readonly userId: string;
    }
  | { readonly kind: "api_key" };

/** What a create needs, decoupled from the RPC request schema. */
export type PostCreateWrite = {
  readonly assetIds: readonly string[];
  /** Present ⇒ the post is created on behalf of the resolved customer. */
  readonly author?: PostWriteAuthor | undefined;
  readonly boardId: string;
  readonly content: string;
  readonly etaQuarter?: string | null | undefined;
  readonly id: string;
  readonly organizationId: string;
  readonly source?:
    | "DASHBOARD"
    | "WIDGET"
    | "API"
    | "IMPORT"
    | "PUBLIC_BOARD"
    | "SLACK"
    | "DISCORD"
    | undefined;
  readonly statusId: string;
  readonly title: string;
};

/**
 * What an update may change. An absent field is left alone; `null` clears a
 * nullable one, which is why `etaQuarter` is not collapsed to `undefined`.
 */
export type PostUpdateWrite = {
  readonly assetIds?: readonly string[] | undefined;
  readonly boardId?: string | undefined;
  /** Raw Markdown; the shared path sanitizes it before it is stored. */
  readonly content?: string | undefined;
  readonly etaQuarter?: string | null | undefined;
  readonly id: string;
  readonly organizationId: string;
  readonly statusId?: string | undefined;
  readonly title?: string | undefined;
};

export type PostRemoveWrite = {
  readonly boardId: string;
  readonly id: string | readonly string[];
  /**
   * Whether the actor may delete a post that already has comments or other
   * people's votes. A member needs `posts.*`; a machine key holding
   * `posts.delete` is the workspace's own credential and always may.
   */
  readonly mayDeleteEngaged: boolean;
  readonly organizationId: string;
};

/**
 * The post write path, shared by the dashboard RPCs and the Public API.
 *
 * A machine key and a member must not diverge on what creating or changing a
 * post means: the sanitizer, the slug deduplication, the timeline entries, the
 * integration events, the outbox intents, and the search embedding are the
 * same work whichever credential asked. A second implementation would drift,
 * and the drift would show up as a post whose history, webhooks, or embedding
 * disagree with the same post made in the dashboard.
 *
 * The member-only side effects (on-behalf attribution, the post creator's
 * subscription, the staff name on an integration event) are branched on the
 * actor instead of being duplicated: a machine key has no email to subscribe
 * and no name to attribute, so those steps are skipped rather than invented.
 *
 * It is a plain `Effect` factory rather than a `Context.Service`, matching
 * `makeChangelogPublication`: both callers already hold the repositories it
 * needs, and the notification service stays optional the way it is optional in
 * the dashboard handlers.
 */
export const makePostWrites = Effect.gen(function* () {
  const boardRepository = yield* BoardRepository;
  const repository = yield* PostRepository;
  const emailOutbox = yield* EmailOutboxRepository;
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const activityRepository = yield* PostActivityRepository;
  const subscriptionRepository = yield* PostSubscriptionRepository;
  const notifications = yield* Effect.serviceOption(NotificationService);
  const embeddingService = yield* Effect.serviceOption(PostEmbeddingService);

  /** The actor columns a timeline entry records. A key is not a member. */
  const actorColumns = (actor: PostWriteActor) =>
    actor.kind === "member"
      ? { actorId: actor.userId, actorMemberId: actor.memberId }
      : { actorId: null, actorMemberId: null };

  // Adapter over the shared integration event recorder: converts the write
  // actor into the safe actor shape and keeps the handler's existing failure
  // classification (lookup problems are update failures, recording problems
  // are internal errors). A key is not a member, so it is classified the way
  // the recorder already classifies an actor with no member id — the closed
  // `member | end_user` vocabulary has no third value (see docs/webhooks.md).
  const recordPostIntegrationEvent = (args: {
    readonly actor: PostWriteActor;
    readonly boardId: string;
    readonly description?: string;
    readonly eventType:
      | "feedback.post.created"
      | "feedback.post.status_changed";
    readonly organizationId: string;
    readonly postId: string;
    readonly postSlug: string;
    readonly previousStatusId?: string;
    readonly statusId: string;
    readonly title: string;
  }) =>
    Effect.gen(function* () {
      const boardId = yield* BoardId.parse(args.boardId);
      const organizationId = yield* WorkspaceId.parse(args.organizationId);
      const postId = yield* PostId.parse(args.postId);
      const statusId = yield* PostStatusId.parse(args.statusId);
      const previousStatusId =
        args.previousStatusId === undefined
          ? undefined
          : yield* PostStatusId.parse(args.previousStatusId);

      return yield* recordPostIntegrationEventShared({
        actor:
          args.actor.kind === "member" && args.actor.memberId !== null
            ? {
                ...(args.actor.name !== undefined &&
                  args.actor.name !== null && {
                    displayName: args.actor.name,
                  }),
                kind: "member",
                memberId: args.actor.memberId,
              }
            : { kind: "end_user" },
        boardId,
        ...(args.description !== undefined && {
          description: args.description,
        }),
        eventType: args.eventType,
        organizationId,
        postId,
        postSlug: args.postSlug,
        ...(previousStatusId !== undefined && { previousStatusId }),
        statusId,
        title: args.title,
      });
    }).pipe(
      Effect.mapError((error) =>
        Predicate.isTagged(error, "PostIntegrationEventRecordingError") &&
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

  /**
   * Reads the post row locked by `findActivityState` inside the enclosing
   * transaction and fails with `FailedToUpdatePostError` when the row is
   * missing or with `PolicyDeniedError` when it has been merged. The locked row
   * is the authoritative answer even if a merge wins the race against an
   * earlier policy check. IDs are plain DB strings here: `postTable` columns
   * are unbranded `text()`.
   */
  const requireNotMergedActivityState = (args: {
    id: string;
    organizationId: string;
  }) =>
    repository.findActivityState(args).pipe(
      Effect.flatMap((previous) =>
        previous === undefined
          ? Effect.fail(new FailedToUpdatePostError())
          : Effect.succeed(previous)
      ),
      Effect.flatMap((post) =>
        post.mergedIntoPostId === null
          ? Effect.succeed(post)
          : Effect.fail(
              new Policy.PolicyDeniedError({
                reason: "This post has been merged into another post",
              })
            )
      )
    );

  /**
   * Rejects a board or status the workspace does not have before the write
   * reaches the foreign keys.
   *
   * An id from another workspace, or a typo, would otherwise fail the
   * constraint and be reported as an internal error for a request the caller
   * can fix. The dashboard already checked the board through its policies; the
   * Public API has no policies to lean on, which is what makes this the shared
   * place for the check rather than the caller's.
   */
  const requireBoard = (args: { boardId: string; organizationId: string }) =>
    Effect.gen(function* () {
      const board = yield* boardRepository.getById({
        id: args.boardId,
        organizationId: args.organizationId,
      });
      if (board._tag === "None") {
        return yield* Effect.fail(
          new BadRequestError({ message: "Board not found" })
        );
      }
      return board.value;
    });

  const requireStatus = (args: { organizationId: string; statusId: string }) =>
    Effect.gen(function* () {
      const statusType = yield* repository.findStatusType({
        id: args.statusId,
        organizationId: args.organizationId,
      });
      if (statusType === undefined) {
        return yield* Effect.fail(
          new BadRequestError({ message: "Post status not found" })
        );
      }
      return statusType;
    });

  const create = (
    args: PostCreateWrite,
    actor: PostWriteActor,
    options: { readonly source?: "PUBLIC_BOARD" } = {}
  ) =>
    Effect.gen(function* () {
      const member = actor.kind === "member" ? actor : null;
      const userId = member?.userId ?? null;
      // `source` is lifted out of the spread and re-added below: the
      // repository's optional property does not accept `undefined`, so an
      // absent source has to stay absent and fall back to the column default.
      const { source, ...write } = args;
      const writeSource = options.source ?? source;

      if (member !== null && args.author !== undefined) {
        // Per-member abuse bound for on-behalf creations (see
        // plan-on-behalf.md); self-service creates are unaffected. Runs before
        // asset prep so a limited request does no work.
        yield* RateLimit.consumeOnBehalfWriteLimit({
          organizationId: args.organizationId,
          userId: member.userId,
        });
      }

      const board = yield* requireBoard({
        boardId: args.boardId,
        organizationId: args.organizationId,
      });

      // A machine key is the workspace's own credential, so the portal's
      // visibility rule does not apply to it: it may write to a private board
      // the same way a member may.
      if (
        member !== null &&
        member.memberId === null &&
        board.visibility !== "PUBLIC"
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: "You are not allowed to post to this board.",
        });
      }

      yield* requireStatus({
        organizationId: args.organizationId,
        statusId: args.statusId,
      });

      const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
        args.content
      );
      const prepared = yield* prepareEditorAssetContent({
        organizationId: args.organizationId,
        ...(userId !== null && { userId }),
        content: sanitizedMarkdown,
        assetIds: args.assetIds,
      });

      const persisted = yield* transaction(
        Effect.gen(function* () {
          // On-behalf attribution resolves the customer inside the same
          // transaction as the mutation (see plan-on-behalf.md). Absent
          // `author`, everything below behaves exactly as before.
          const subject =
            args.author === undefined
              ? undefined
              : yield* resolveOnBehalfSubject({
                  organizationId: args.organizationId,
                  needsUser: false,
                  subject: args.author,
                  action: "post author",
                });
          const onBehalfMetadata = toOnBehalfMetadata(subject);
          const persistedSlug = yield* repository.create({
            ...write,
            content: prepared.content,
            excerpt: htmlToExcerpt(sanitizedHtml),
            creatorId: subject ? subject.userId : userId,
            ...(writeSource !== undefined && { source: writeSource }),
            // On-behalf posts keep staff attribution out of the author fields.
            ...(member !== null &&
              member.memberId !== null &&
              !subject && { creatorMemberId: member.memberId }),
            ...(subject && { contactId: subject.contactId }),
          });
          yield* commitPreparedEditorAssets(prepared.promotions);
          yield* syncPostAssetReferences({
            postId: args.id,
            organizationId: args.organizationId,
            ...(userId !== null && { userId }),
            content: prepared.content,
            assetIds: args.assetIds,
          });

          yield* activityRepository.create({
            organizationId: args.organizationId,
            postId: args.id,
            ...actorColumns(actor),
            kind: "POST_CREATED",
            ...(onBehalfMetadata && { metadata: onBehalfMetadata }),
          });
          yield* recordPostIntegrationEvent({
            actor,
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
          // staff actor, following the same notification-eligibility rules: a
          // verified account is trusted, everyone else is deferred until
          // identity linking grants them access. A machine key has no person
          // behind it, so there is nobody to subscribe.
          const subscriptionNow = yield* DateTime.nowAsDate;
          if (subject === undefined) {
            if (member !== null) {
              yield* subscriptionRepository.subscribe({
                organizationId: args.organizationId,
                postId: args.id,
                userId: member.userId,
                ...(member.memberId !== null && {
                  memberId: member.memberId,
                }),
              });
              yield* emailSubscriptions
                .requestSubscription({
                  alreadyVerifiedUser: { userId: member.userId },
                  email: member.email,
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
            }
          } else {
            // In-app watch-list parity for the attributed author.
            if (subject.userId !== null) {
              yield* subscriptionRepository.subscribe({
                organizationId: args.organizationId,
                postId: args.id,
                userId: subject.userId,
              });
            }
            yield* subscribeOnBehalfSubject({
              organizationId: args.organizationId,
              topicId: args.id,
              subject,
              source: "post_creator",
              subjectKind: "post author",
              now: subscriptionNow,
            });
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
                actorUserId: member?.userId ?? null,
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

  /**
   * Changes whichever fields are named, in one transaction.
   *
   * Every dashboard update RPC is a subset of this: the title, content, ETA,
   * and status/board RPCs each pass one field, and the Public API's `PATCH`
   * may pass several at once. Unifying them is what makes a multi-field API
   * update atomic and keeps the timeline, integration events, and outbox
   * intents identical to the dashboard's.
   *
   * A field is only written when it actually changes, matching the per-RPC
   * behaviour: a title or ETA that is re-sent unchanged does not bump
   * `updatedAt`, while a status or board write always does — the dashboard's
   * status RPC updates the row unconditionally, and that is preserved.
   */
  const update = (args: PostUpdateWrite, actor: PostWriteActor) =>
    Effect.gen(function* () {
      const member = actor.kind === "member" ? actor : null;
      const userId = member?.userId ?? null;
      const columns = actorColumns(actor);

      if (args.boardId !== undefined) {
        yield* requireBoard({
          boardId: args.boardId,
          organizationId: args.organizationId,
        });
      }
      // Fetched once and reused below, so the status-change branch does not
      // read it again inside the transaction. A status's type is fixed when the
      // workspace is created — there is no RPC that changes it — so the value
      // cannot go stale between here and the write.
      const nextStatusType =
        args.statusId === undefined
          ? undefined
          : yield* requireStatus({
              organizationId: args.organizationId,
              statusId: args.statusId,
            });

      const sanitized =
        args.content === undefined ? undefined : sanitizeMarkdown(args.content);
      const prepared =
        sanitized === undefined
          ? undefined
          : yield* prepareEditorAssetContent({
              organizationId: args.organizationId,
              ...(userId !== null && { userId }),
              content: sanitized.sanitizedMarkdown,
              assetIds: args.assetIds ?? [],
            }).pipe(
              Effect.map((prepared) => ({
                ...prepared,
                excerpt: htmlToExcerpt(sanitized.sanitizedHtml),
              }))
            );

      let outboxId: string | undefined;
      let embeddingNeeded = false;
      let finalTitle = "";
      let finalContent = "";

      const write = Effect.gen(function* () {
        const previous = yield* requireNotMergedActivityState({
          id: args.id,
          organizationId: args.organizationId,
        });

        const titleChanged =
          args.title !== undefined && previous.title !== args.title;
        const contentChanged =
          prepared !== undefined && previous.content !== prepared.content;
        const statusChanged =
          args.statusId !== undefined && previous.statusId !== args.statusId;
        const boardChanged =
          args.boardId !== undefined && previous.boardId !== args.boardId;
        const etaChanged =
          args.etaQuarter !== undefined &&
          previous.etaQuarter !== args.etaQuarter;

        finalTitle = args.title ?? previous.title;
        finalContent = prepared?.content ?? previous.content;

        const activities: PostActivityInput[] = [];
        if (titleChanged) {
          activities.push({
            ...columns,
            kind: "TITLE_CHANGED",
            organizationId: args.organizationId,
            postId: args.id,
            previousTitle: previous.title,
            nextTitle: args.title,
          });
        }
        if (contentChanged) {
          activities.push({
            ...columns,
            kind: "CONTENT_CHANGED",
            organizationId: args.organizationId,
            postId: args.id,
          });
        }
        if (statusChanged) {
          activities.push({
            ...columns,
            kind: "STATUS_CHANGED",
            organizationId: args.organizationId,
            postId: args.id,
            previousStatusId: previous.statusId,
            nextStatusId: args.statusId,
          });
        }
        if (boardChanged) {
          activities.push({
            ...columns,
            kind: "BOARD_CHANGED",
            organizationId: args.organizationId,
            postId: args.id,
            previousBoardId: previous.boardId,
            nextBoardId: args.boardId,
          });
        }
        if (etaChanged) {
          activities.push({
            ...columns,
            kind: "ETA_CHANGED",
            organizationId: args.organizationId,
            postId: args.id,
            previousEta: previous.etaQuarter,
            nextEta: args.etaQuarter,
          });
        }

        const writesRow =
          titleChanged ||
          contentChanged ||
          etaChanged ||
          args.statusId !== undefined ||
          args.boardId !== undefined;
        if (writesRow) {
          yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            ...(args.statusId !== undefined && { statusId: args.statusId }),
            ...(args.boardId !== undefined && { boardId: args.boardId }),
            ...(args.title !== undefined && { title: args.title }),
            ...(prepared !== undefined && {
              content: prepared.content,
              excerpt: prepared.excerpt,
            }),
            ...(args.etaQuarter !== undefined && {
              etaQuarter: args.etaQuarter,
            }),
          });
        }

        if (prepared !== undefined) {
          yield* commitPreparedEditorAssets(prepared.promotions);
          yield* syncPostAssetReferences({
            postId: args.id,
            organizationId: args.organizationId,
            ...(userId !== null && { userId }),
            content: prepared.content,
            assetIds: args.assetIds ?? [],
          });
        }

        yield* activityRepository.createMany(activities);

        if (statusChanged && args.statusId !== undefined) {
          yield* recordPostIntegrationEvent({
            actor,
            boardId: args.boardId ?? previous.boardId,
            eventType: "feedback.post.status_changed",
            organizationId: args.organizationId,
            postId: args.id,
            postSlug: previous.slug,
            previousStatusId: previous.statusId,
            statusId: args.statusId,
            title: finalTitle,
          });

          const maySend = yield* entitlementPolicy.mayMaterializeEmailIntent({
            organizationId: args.organizationId,
            kind: "post.status_changed",
          });
          if (maySend) {
            const now = yield* DateTime.nowAsDate;
            if (nextStatusType === "CLOSED") {
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
                        message: "Could not record post closure email intent.",
                      })
                  )
                );
              outboxId =
                result._tag === "Inserted" ? result.intent.id : undefined;
            } else {
              const result = yield* emailOutbox
                .upsertPendingStatusChange({
                  aggregateId: args.id,
                  aggregateType: "post",
                  deduplicationKey: `post.status_changed:${args.organizationId}:${args.id}:${now.getTime()}`,
                  expiresAt: new Date(
                    now.getTime() + postStatusCoalescingDelayMs + 7 * 86_400_000
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
              outboxId =
                result._tag === "Written" ? result.intent.id : undefined;
            }
          }

          yield* Option.match(notifications, {
            onNone: () => Effect.void,
            onSome: (service) =>
              service.notifyPostStatusChanged({
                organizationId: args.organizationId,
                postId: args.id,
                actorUserId: member?.userId ?? null,
              }),
          });
        }

        embeddingNeeded = titleChanged || contentChanged;
      });

      yield* transaction(write).pipe(
        prepared === undefined
          ? (effect) => effect
          : (effect) =>
              effect.pipe(
                Effect.tapCause(() =>
                  rollbackPreparedEditorAssets(prepared.promotions)
                ),
                Effect.ensuring(
                  cleanupPreparedEditorAssets(prepared.promotions)
                )
              )
      );

      yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
      if (embeddingNeeded) {
        yield* scheduleEmbedding({
          content: finalContent,
          id: args.id,
          organizationId: args.organizationId,
          title: finalTitle,
        });
      }
    });

  /**
   * Deletes a post and reverts its merged children.
   *
   * The dashboard's delete is creator-scoped unless the caller holds
   * `posts.*`; a machine key holding `posts.delete` is the workspace's own
   * credential and always may, which is what `mayDeleteEngaged` carries.
   */
  const remove = (args: PostRemoveWrite, actor: PostWriteActor) =>
    Effect.gen(function* () {
      const columns = actorColumns(actor);

      const result = yield* transaction(
        Effect.gen(function* () {
          const outcome = yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
            boardId: args.boardId,
            creatorId: columns.actorId,
            onlyIfNew: !args.mayDeleteEngaged,
          });
          // Deleting a survivor reverts its merged children so the FK cannot
          // block the delete and no post is orphaned. Record the reversal on
          // each child's timeline, mirroring `PostUnmerge`.
          if (outcome.restoredChildren.length > 0) {
            yield* activityRepository.createMany(
              outcome.restoredChildren.map((child) => ({
                ...columns,
                kind: "POST_UNMERGED" as const,
                organizationId: args.organizationId,
                postId: child.id,
                targetPostId: child.mergedIntoPostId,
              }))
            );
          }
          return outcome;
        })
      );

      if (!(result.deleted || args.mayDeleteEngaged)) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Posts with comments or other users' votes cannot be deleted",
        });
      }

      // A privileged delete that matched no row means the post does not exist
      // (or belongs to another org/board) — report that instead of silently
      // succeeding.
      if (!result.deleted) {
        return yield* new PostNotFoundError({
          message: "Post not found",
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

  return { create, remove, update };
});
