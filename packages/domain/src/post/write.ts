import { Database, schema, transaction } from "@feeblo/db";
import { BoardId, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
import { EmailOutboxConfig } from "../email-outbox/config";
import { wakeEmailOutboxBestEffort } from "../email-outbox/queue";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import {
  resolveOnBehalfSubject,
  subscribeOnBehalfSubject,
  toOnBehalfMetadata,
} from "../identity/on-behalf";
import { ResolvePrincipalService } from "../identity/service";
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
import { S3UploadService } from "../services/s3";
import { UserRepository } from "../user/repository";
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
  /**
   * The instant the post is recorded as created, when the caller supplies
   * one. An import uses this to backdate history; an ordinary create leaves it
   * absent and the row is stamped with the write's own clock. `updatedAt` is
   * still the write's clock, so a sync filtering by `updatedAfter` sees the
   * import rather than silently missing it.
   */
  readonly createdAt?: Date | undefined;
  readonly etaQuarter?: string | null | undefined;
  readonly id: string;
  /**
   * Flat string map stored on the post row and carried verbatim on the
   * post-created integration event. Only the widget's SSO payload supplies
   * one today; every other surface leaves it absent.
   */
  readonly metadata?: Readonly<Record<string, string>> | undefined;
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

/** Options for one create write, beyond the post fields themselves. */
type PostCreateWriteOptions = {
  readonly source?: "PUBLIC_BOARD";
  /**
   * The post creator to attribute and watch-list when the acting credential
   * has no session of its own to subscribe from — an inbound end-user
   * identity (Slack, Discord) whose feeblo user row the caller resolved. A
   * member session subscribes through its own branch; a machine key creating
   * on behalf of `author` subscribes the subject instead. No email
   * subscription is requested from this option: inbound identities carry
   * synthetic inboxes that must never enter the email pipeline.
   */
  readonly subscribeCreatorUserId?: string;
};

/**
 * What an update may change. An absent field is left alone; `null` clears a
 * nullable one, which is why `etaQuarter` is not collapsed to `undefined`.
 */
export type PostUpdateWrite = {
  readonly assetIds?: readonly string[] | undefined;
  /**
   * Present ⇒ the post is re-attributed to the resolved customer. Absent
   * leaves the current author alone; unlike `etaQuarter`, an explicit `null`
   * is not a value the resolver accepts.
   */
  readonly author?: PostWriteAuthor | undefined;
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

/** What a merge needs: the duplicate, and the post that survives it. */
export type PostMergeWrite = {
  readonly organizationId: string;
  readonly sourcePostId: string;
  readonly targetPostId: string;
};

/** What an unmerge needs: the archived source to restore. */
export type PostUnmergeWrite = {
  readonly organizationId: string;
  readonly sourcePostId: string;
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
 * The path is one service, `PostWriteService`: it captures its required
 * collaborators at construction and provides them to every operation, so a
 * caller depends on the one tag instead of restating the environment. The
 * optional fan-outs — notifications, embeddings, the rate limiter, the outbox
 * wake — resolve from the running context per operation, so a composition that
 * omits them skips them rather than failing.
 */
const makePostWriteService = Effect.gen(function* () {
  const boardRepository = yield* BoardRepository;
  const crypto = yield* Crypto.Crypto;
  const db = yield* Database.Database;
  const emailOutbox = yield* EmailOutboxRepository;
  const emailOutboxConfig = yield* EmailOutboxConfig;
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const integrationEventRecorder = yield* IntegrationEventRecorder;
  const activityRepository = yield* PostActivityRepository;
  const repository = yield* PostRepository;
  const resolvePrincipal = yield* ResolvePrincipalService;
  const s3 = yield* S3UploadService;
  const subscriptionRepository = yield* PostSubscriptionRepository;
  const userRepository = yield* UserRepository;

  /**
   * The services the write operations read from the running context, captured
   * once at construction.
   *
   * The operations and their helpers read some collaborators directly and
   * others through the fiber context (the asset promotion's storage, the
   * integration event recorder, the identity resolver). Providing this one
   * layer around each operation is what lets a caller depend on
   * `PostWriteService` alone. The list is hand-maintained: a new requirement
   * read by an operation leaks into the method's inferred requirements and
   * fails at the composition root, not here.
   */
  const environment = Layer.mergeAll(
    Layer.succeed(BoardRepository, boardRepository),
    Layer.succeed(Crypto.Crypto, crypto),
    Layer.succeed(Database.Database, db),
    Layer.succeed(EmailOutboxConfig, emailOutboxConfig),
    Layer.succeed(EmailOutboxRepository, emailOutbox),
    Layer.succeed(EmailSubscriptionRepository, emailSubscriptions),
    Layer.succeed(EntitlementPolicy, entitlementPolicy),
    Layer.succeed(IntegrationEventRecorder, integrationEventRecorder),
    Layer.succeed(PostActivityRepository, activityRepository),
    Layer.succeed(PostRepository, repository),
    Layer.succeed(PostSubscriptionRepository, subscriptionRepository),
    Layer.succeed(ResolvePrincipalService, resolvePrincipal),
    Layer.succeed(S3UploadService, s3),
    Layer.succeed(UserRepository, userRepository)
  );
  const provideWriteEnvironment = Effect.provide(environment);

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
    readonly eventType: "post.created" | "post.status_changed";
    /** Validated metadata the caller already vetted; forwarded verbatim. */
    readonly metadata?: Readonly<Record<string, string>>;
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
      // The event carries the same metadata the post row stores, so a webhook
      // consumer sees what the dashboard does. Empty objects stay absent, as
      // the recorder itself decides.
      const eventMetadata =
        args.metadata === undefined
          ? undefined
          : Object.keys(args.metadata).length === 0
            ? undefined
            : args.metadata;
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
        eventType: args.eventType,
        ...(eventMetadata !== undefined && { metadata: eventMetadata }),
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
    Effect.gen(function* () {
      // Resolved per call, not captured: a caller may compose the write path
      // with or without an embedding service, and the absent case is a skip
      // rather than a failure.
      const embeddingService =
        yield* Effect.serviceOption(PostEmbeddingService);
      if (Option.isNone(embeddingService)) {
        return;
      }
      yield* schedulePostEmbeddingBestEffort({
        content,
        embeddingService: embeddingService.value,
        postId: id,
        organizationId,
        title,
      });
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
      Effect.filterOrFail(
        (post) => post !== undefined,
        () => new FailedToUpdatePostError()
      ),
      Effect.filterOrFail(
        (post) => post.mergedIntoPostId === null,
        () =>
          new Policy.PolicyDeniedError({
            reason: "This post has been merged into another post",
          })
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
        return yield* new BadRequestError({ message: "Board not found" });
      }
      return board.value;
    });

  const requireStatus = (args: { organizationId: string; statusId: string }) =>
    Effect.gen(function* () {
      const status = yield* repository.findStatus({
        id: args.statusId,
        organizationId: args.organizationId,
      });
      if (status === undefined) {
        return yield* new BadRequestError({
          message: "Post status not found",
        });
      }
      return status;
    });

  const create = (
    args: PostCreateWrite,
    actor: PostWriteActor,
    options: PostCreateWriteOptions = {}
  ) =>
    Effect.gen(function* () {
      // Optional capabilities resolve from the running context, so a
      // composition that omits them skips the fan-out instead of failing.
      const notifications = yield* Effect.serviceOption(NotificationService);
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
          // First lock, first: the submission window is created later in this
          // transaction, and its per-workspace serialization holds the
          // organization row. Taking it before the post insert keeps two
          // concurrent creates from deadlocking — each insert's foreign-key
          // check holds a key-share on the org row that conflicts with this
          // lock, so locking after the insert would make each transaction wait
          // for the other and Postgres would abort one of them. The
          // roadmap repository takes the same lock in the same position.
          yield* emailOutbox.lockOrganization(args.organizationId);

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
            // The resolved inbound end user is the creator even though the
            // credential is a machine key: creator-based reads ("my posts")
            // and the edit/delete permissions key off this column, so leaving
            // it null would store the submitter's own post as unowned. A
            // member's own id still wins when there is one.
            creatorId: subject
              ? subject.userId
              : (userId ?? options.subscribeCreatorUserId ?? null),
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
            eventType: "post.created",
            ...(args.metadata !== undefined && { metadata: args.metadata }),
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
          // behind it, so there is nobody to subscribe — unless the caller
          // resolved the inbound end user for it (Slack, Discord).
          const subscriptionNow = yield* DateTime.nowAsDate;
          if (subject === undefined) {
            const inboundCreatorUserId = options.subscribeCreatorUserId;
            const creator =
              member !== null
                ? {
                    email: member.email,
                    memberId: member.memberId,
                    userId: member.userId,
                  }
                : inboundCreatorUserId !== undefined
                  ? {
                      email: undefined,
                      memberId: null,
                      userId: inboundCreatorUserId,
                    }
                  : undefined;
            if (creator !== undefined) {
              yield* subscriptionRepository.subscribe({
                organizationId: args.organizationId,
                postId: args.id,
                userId: creator.userId,
                ...(creator.memberId !== null && {
                  memberId: creator.memberId,
                }),
              });
              if (creator.email !== undefined) {
                yield* emailSubscriptions
                  .requestSubscription({
                    alreadyVerifiedUser: { userId: creator.userId },
                    email: creator.email,
                    now: subscriptionNow,
                    organizationId: args.organizationId,
                    source: "post_creator",
                    topic: { topicId: args.id, topicType: "post" },
                    verificationExpiresAt: DateTime.fromDateUnsafe(
                      subscriptionNow
                    ).pipe(
                      DateTime.addDuration(Duration.days(1)),
                      DateTime.toDate
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

          const submissionWindow = yield* emailOutbox
            .upsertPendingSubmissionWindow({
              now: subscriptionNow,
              organizationId: args.organizationId,
              postId: args.id,
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
            outboxId:
              submissionWindow._tag === "Written"
                ? submissionWindow.intentId
                : undefined,
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
      const notifications = yield* Effect.serviceOption(NotificationService);
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
      const nextStatus =
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

        // Re-attribution is part of the same transaction as the field writes,
        // so a `PATCH` that names a title and an author is atomic: either the
        // post and its timeline both move or neither does. The dashboard's
        // `PostUpdateAuthor` RPC is this branch with no other field named.
        if (args.author !== undefined) {
          const subject = yield* resolveOnBehalfSubject({
            organizationId: args.organizationId,
            needsUser: false,
            subject: args.author,
            action: "post author",
          });

          if (
            previous.contactId !== subject.contactId ||
            previous.creatorId !== subject.userId
          ) {
            const onBehalfMetadata = toOnBehalfMetadata(subject);
            yield* repository.updateAuthor({
              contactId: subject.contactId,
              // On-behalf posts keep staff attribution out of the author
              // fields, matching the create path.
              creatorId: subject.userId,
              creatorMemberId: null,
              id: args.id,
              organizationId: args.organizationId,
            });
            yield* activityRepository.create({
              ...columns,
              kind: "AUTHOR_CHANGED",
              organizationId: args.organizationId,
              postId: args.id,
              ...(onBehalfMetadata && { metadata: onBehalfMetadata }),
            });

            // The new author inherits the creator subscription exactly as if
            // the post had been created on their behalf: a verified account
            // is trusted, everyone else defers until identity linking grants
            // them access. The previous author is unsubscribed first —
            // otherwise they keep receiving status mail for a post no longer
            // attributed to them. Only identifiers that differ from the new
            // subject's are retired, so a shared address survives for the
            // fresh subscribe below.
            const subscriptionNow = yield* DateTime.nowAsDate;
            const retiredUserId =
              previous.creatorId !== null &&
              previous.creatorId !== subject.userId
                ? previous.creatorId
                : null;
            if (retiredUserId !== null) {
              yield* subscriptionRepository.unsubscribe({
                postId: args.id,
                userId: retiredUserId,
              });
            }
            let retiredContactEmail: string | null = null;
            if (
              previous.contactId !== null &&
              previous.contactId !== subject.contactId
            ) {
              const [previousContact] = yield* db
                .select({ email: schema.contactTable.email })
                .from(schema.contactTable)
                .where(eq(schema.contactTable.id, previous.contactId))
                .limit(1);
              retiredContactEmail = previousContact?.email ?? null;
            }
            if (retiredUserId !== null || retiredContactEmail !== null) {
              yield* emailSubscriptions.unsubscribePreviousAuthorTopic({
                contactEmail: retiredContactEmail,
                now: subscriptionNow,
                organizationId: args.organizationId,
                topic: { topicId: args.id, topicType: "post" },
                userId: retiredUserId,
              });
            }
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
        }

        if (statusChanged && args.statusId !== undefined) {
          yield* recordPostIntegrationEvent({
            actor,
            boardId: args.boardId ?? previous.boardId,
            eventType: "post.status_changed",
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
            if (nextStatus?.type === "CLOSED") {
              const result = yield* emailOutbox
                .recordIntent({
                  aggregateId: args.id,
                  aggregateType: "post",
                  // Timestamped like the merge and unmerge intents, so closing
                  // a post, reopening it, and closing it again announces each
                  // closure instead of matching the first attempt forever.
                  deduplicationKey: `post.closed:${args.organizationId}:${args.id}:${args.statusId}:${now.getTime()}`,
                  expiresAt: DateTime.fromDateUnsafe(now).pipe(
                    DateTime.addDuration(Duration.days(7)),
                    DateTime.toDate
                  ),
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
                  expiresAt: DateTime.fromDateUnsafe(now).pipe(
                    DateTime.addDuration(
                      Duration.millis(postStatusCoalescingDelayMs)
                    ),
                    DateTime.addDuration(Duration.days(7)),
                    DateTime.toDate
                  ),
                  organizationId: args.organizationId,
                  payload: {
                    kind: "post.status_changed",
                    postId: args.id,
                    statusId: args.statusId,
                  },
                  scheduledAt: DateTime.fromDateUnsafe(now).pipe(
                    DateTime.addDuration(
                      Duration.millis(postStatusCoalescingDelayMs)
                    ),
                    DateTime.toDate
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

  /**
   * Merges one post into another, and reverts a merge.
   *
   * The move itself is `PostRepository`'s: the locked rows, the chained-merge
   * and archived refusals, and the engagement reassignment are one
   * implementation the dashboard and the Public API share. What this adds is
   * what every write path adds — the timeline entries that record both
   * directions of a merge, the in-app notification, and the durable email
   * intent — with the actor the caller supplies, so a merge performed with a
   * machine key lands in the same timeline and the same inbox as one a member
   * performs.
   */
  const merge = (args: PostMergeWrite, actor: PostWriteActor) =>
    Effect.gen(function* () {
      const notifications = yield* Effect.serviceOption(NotificationService);
      const columns = actorColumns(actor);
      const member = actor.kind === "member" ? actor : null;

      const outboxId = yield* transaction(
        Effect.gen(function* () {
          yield* repository.merge(args);
          // Both directions: the survivor's timeline shows which duplicate it
          // absorbed, and the archived source's explains where it went, so the
          // source is not a silent tombstone.
          yield* activityRepository.create({
            ...columns,
            kind: "POST_MERGED",
            mergedPostId: args.sourcePostId,
            organizationId: args.organizationId,
            postId: args.targetPostId,
          });
          yield* activityRepository.create({
            ...columns,
            kind: "POST_MERGED_INTO",
            organizationId: args.organizationId,
            postId: args.sourcePostId,
            targetPostId: args.targetPostId,
          });
          // Subscribers and voters of both posts learn where the duplicate
          // went. Runs after the repository move so the survivor's queries
          // include the carried-over source rows.
          yield* Option.match(notifications, {
            onNone: () => Effect.void,
            onSome: (service) =>
              service.notifyPostMerged({
                actorUserId: member?.userId ?? null,
                organizationId: args.organizationId,
                sourcePostId: args.sourcePostId,
                targetPostId: args.targetPostId,
              }),
          });
          if (
            !(yield* entitlementPolicy.mayMaterializeEmailIntent({
              kind: "post.merged",
              organizationId: args.organizationId,
            }))
          ) {
            return undefined;
          }
          const now = yield* DateTime.nowAsDate;
          const result = yield* emailOutbox
            .recordIntent({
              aggregateId: args.sourcePostId,
              aggregateType: "post",
              deduplicationKey: `post.merged:${args.organizationId}:${args.sourcePostId}:${args.targetPostId}:${now.getTime()}`,
              expiresAt: DateTime.fromDateUnsafe(now).pipe(
                DateTime.addDuration(Duration.days(7)),
                DateTime.toDate
              ),
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
    });

  /**
   * Restores an archived source post to the board it was merged away from.
   *
   * The inverse of `merge`, and the same shape: the repository moves the
   * engagement back and this records the reversal on the source's timeline,
   * tells the people who were told about the merge, and leaves the durable
   * email intent.
   */
  const unmerge = (args: PostUnmergeWrite, actor: PostWriteActor) =>
    Effect.gen(function* () {
      const notifications = yield* Effect.serviceOption(NotificationService);
      const columns = actorColumns(actor);
      const member = actor.kind === "member" ? actor : null;

      const outboxId = yield* transaction(
        Effect.gen(function* () {
          const targetPostId = yield* repository.unmerge(args);
          // Restoring reverses the tombstone, so the source's timeline records
          // which post it was detached from.
          yield* activityRepository.create({
            ...columns,
            kind: "POST_UNMERGED",
            organizationId: args.organizationId,
            postId: args.sourcePostId,
            targetPostId,
          });
          yield* Option.match(notifications, {
            onNone: () => Effect.void,
            onSome: (service) =>
              service.notifyPostUnmerged({
                actorUserId: member?.userId ?? null,
                organizationId: args.organizationId,
                sourcePostId: args.sourcePostId,
                targetPostId,
              }),
          });
          if (
            !(yield* entitlementPolicy.mayMaterializeEmailIntent({
              kind: "post.unmerged",
              organizationId: args.organizationId,
            }))
          ) {
            return undefined;
          }
          const now = yield* DateTime.nowAsDate;
          const result = yield* emailOutbox
            .recordIntent({
              aggregateId: args.sourcePostId,
              aggregateType: "post",
              // Timestamped so a post merged, unmerged, and merged again sends
              // a fresh email instead of matching the first attempt.
              deduplicationKey: `post.unmerged:${args.organizationId}:${args.sourcePostId}:${targetPostId}:${now.getTime()}`,
              expiresAt: DateTime.fromDateUnsafe(now).pipe(
                DateTime.addDuration(Duration.days(7)),
                DateTime.toDate
              ),
              kind: "post.unmerged",
              organizationId: args.organizationId,
              payload: {
                kind: "post.unmerged",
                postId: args.sourcePostId,
                targetPostId,
              },
              scheduledAt: now,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({
                    message: "Could not record post unmerge email intent.",
                  })
              )
            );
          return result._tag === "Inserted" ? result.intent.id : undefined;
        })
      );
      yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
    });

  return {
    create: Effect.fn("PostWriteService.create")(function* (
      args: PostCreateWrite,
      actor: PostWriteActor,
      options: PostCreateWriteOptions = {}
    ) {
      return yield* create(args, actor, options).pipe(provideWriteEnvironment);
    }),
    merge: Effect.fn("PostWriteService.merge")(function* (
      args: PostMergeWrite,
      actor: PostWriteActor
    ) {
      return yield* merge(args, actor).pipe(provideWriteEnvironment);
    }),
    remove: Effect.fn("PostWriteService.remove")(function* (
      args: PostRemoveWrite,
      actor: PostWriteActor
    ) {
      return yield* remove(args, actor).pipe(provideWriteEnvironment);
    }),
    unmerge: Effect.fn("PostWriteService.unmerge")(function* (
      args: PostUnmergeWrite,
      actor: PostWriteActor
    ) {
      return yield* unmerge(args, actor).pipe(provideWriteEnvironment);
    }),
    update: Effect.fn("PostWriteService.update")(function* (
      args: PostUpdateWrite,
      actor: PostWriteActor
    ) {
      return yield* update(args, actor).pipe(provideWriteEnvironment);
    }),
  };
});

/**
 * The post write path: every create, update, remove, merge, and unmerge,
 * whichever credential asked.
 *
 * The layer carries the path's required environment, so the operations require
 * nothing of their callers and the composition root supplies the collaborators
 * once; a required collaborator missing from the layer is a gap in the
 * composition root's type instead of a request-time failure. The optional
 * fan-outs are read from the request context, so the root must keep
 * `NotificationService` and `PostEmbeddingService` in it (see
 * `apps/server/src/app/layers.ts`). The dashboard RPCs, the Public API, the
 * widget feedback endpoint, and the Slack and Discord inbound feedback
 * services all depend on this one tag.
 */
export class PostWriteService extends Context.Service<PostWriteService>()(
  "PostWriteService",
  { make: makePostWriteService }
) {
  /**
   * The path's required environment as a layer: every collaborator is a
   * requirement, so the composition root names them once and a test
   * substitutes only what it must.
   */
  static readonly layer = Layer.effect(this, this.make);
}
