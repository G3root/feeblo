import { transaction } from "@feeblo/db";
import * as Permissions from "@feeblo/permissions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import {
  type PostActivityInput,
  PostActivityRepository,
} from "../post-activity/repository";
import {
  redactCreatorIdentities,
  redactCreatorIdentity,
} from "../public-actor";
import { currentPublicViewer, withPublicViewer } from "../public-read";
import * as RateLimit from "../rate-limit";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession, type Session } from "../session-middleware";
import { type Surface, definePublicEntry, defineSurfacePair } from "../surface";
import { ParticipationPolicy } from "../user-ban/policies";
import { WorkspaceRepository } from "../workspace/repository";
import { PostEmbeddingService } from "./embedding-service";
import {
  FailedToUpdatePostError,
  PostAlreadyExistsError,
  PostNotFoundError,
} from "./errors";
import {
  LOCKED_POST_ENGAGEMENT,
  engagementForLock,
  engagementOf,
  isArchivedPostPresence,
  isMergedPostRow,
  presenceOf,
} from "./machine";
import { PostPolicy } from "./policies";
import { PostRepository } from "./repository";
import { PostRpcs } from "./rpcs";
import type {
  TPostAdminUpdate,
  TPostCreate,
  TPostDelete,
  TPostDeleteEligibilityList,
  TPostDeleteEligibilityListPublic,
  TPostGet,
  TPostList,
  TPostMerge,
  TPostOfficialUpdatePublish,
  TPostSuggestions,
  TPostUpdate,
  TPostUpdateAssignee,
  TPostUpdateAuthor,
  TPostUpdateContent,
  TPostUpdateEta,
  TPostUpdateTitle,
  TPostUnmerge,
} from "./schema";
import { makePostSuggestions } from "./suggestions";
import { PostWriteService, type PostWriteActor } from "./write";

/** The RPCs this group declares; a surface pair's operation must be one. */
type PostRpcTag = RpcTagsOf<typeof PostRpcs>;

export const PostRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostRepository;
  const activityRepository = yield* PostActivityRepository;
  const postPolicy = yield* PostPolicy;
  const embeddingService = yield* Effect.serviceOption(PostEmbeddingService);
  // const sitePolicy = yield* SitePolicy;
  const participation = yield* ParticipationPolicy;

  // -- Shared effect helpers (no policy applied) --

  // The dashboard runs the same create, update, and delete the Public API runs
  // (see `write.ts`), parameterized by who is writing. The actor is built here
  // from the session the policies below have already resolved; a machine key
  // never reaches this module.
  const writes = yield* PostWriteService;

  const memberActor = (
    session: Session,
    organizationId: string
  ): PostWriteActor => ({
    email: session.user.email,
    kind: "member",
    memberId:
      Policy.getMembership(session, organizationId)?.membershipId ?? null,
    name: session.user.name,
    userId: session.session.userId,
  });

  /**
   * Reads the post row locked by `findActivityState` inside the enclosing
   * transaction and fails with `FailedToUpdatePostError` when the row is
   * missing or with `PolicyDeniedError` when it has been merged. The
   * `isNotMerged` policy runs before the transaction, so a concurrent merge
   * can win that race; the locked row is the authoritative answer. Denies
   * before no-change returns and before any write or asset sync. IDs are
   * plain DB strings here: `postTable` columns are unbranded `text()`.
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
        (post) => !isMergedPostRow(post),
        () =>
          new Policy.PolicyDeniedError({
            reason: "This post has been merged into another post",
          })
      )
    );

  const suggestions = makePostSuggestions({
    candidates: repository.findSuggestionCandidates,
    embeddings: embeddingService,
  });

  /**
   * The ids in a delete request that exist on the board it names.
   *
   * The shared write path reports one verdict for the whole request, and a
   * privileged bulk delete tolerates an id that matches nothing, so the audit
   * entries are written for the rows the delete could have removed rather than
   * for whatever the client sent.
   */
  /**
   * Re-attributes a post to a resolved on-behalf subject.
   *
   * The resolution, the author columns, the timeline entry, and the
   * subscription move are the shared write path's `author` branch
   * (`post/write.ts`), so the Public API's `PATCH` performs exactly this and
   * the two cannot drift.
   */
  const updatePostAuthorEffect = (args: TPostUpdateAuthor) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      // Reassignment find-or-creates contacts like on-behalf creation, so it
      // shares the same per-member abuse bound (see plan-on-behalf.md).
      yield* RateLimit.consumeOnBehalfWriteLimit({
        organizationId: args.organizationId,
        userId: session.session.userId,
      });

      yield* writes.update(
        {
          author: args.author,
          id: args.id,
          organizationId: args.organizationId,
        },
        memberActor(session, args.organizationId)
      );
    });

  // -- Surface-parameterized writes --
  //
  // The dashboard RPC and the public portal RPC are two names for one write;
  // the shared body takes the surface, and the pair holds the policy and
  // rate-limit level that differ. Public updates are rename semantics only,
  // which is why `UpdatePost`'s public policy adds `hasUnchangedLocation`.

  // One factory per admission rule the surfaces share: each entry passes its
  // own surface to it, so the policy's `source` is the surface the entry
  // actually answers and the halves cannot disagree.
  const canDeleteAs = (args: TPostDelete, surface: Surface) =>
    postPolicy.canDelete({
      boardId: args.boardId,
      organizationId: args.organizationId,
      postId: args.id,
      source: surface,
    });

  const deleteWrite = defineSurfacePair<TPostDelete, PostRpcTag>()({
    operation: "DeletePost",
    remap: { action: "delete", entity: "Post" },
    dashboard: { rateLimit: undefined, policy: canDeleteAs },
    public: { rateLimit: "write", policy: canDeleteAs },
  });

  const updateWrite = defineSurfacePair<TPostUpdate, PostRpcTag>()({
    operation: "UpdatePost",
    remap: { action: "update", entity: "Post" },
    dashboard: {
      rateLimit: undefined,
      policy: (args: TPostUpdate) =>
        postPolicy.canUpdateProperties({
          boardId: args.boardId,
          organizationId: args.organizationId,
          postId: args.id,
          statusId: args.statusId,
          source: "dashboard",
        }),
    },
    public: {
      rateLimit: "expensive",
      policy: (args: TPostUpdate) =>
        Policy.all(
          postPolicy.canUpdate({
            boardId: args.boardId,
            organizationId: args.organizationId,
            postId: args.id,
            source: "public",
          }),
          // Public updates are rename semantics only: a creator must never
          // be able to change their post's status or move it across boards.
          postPolicy.hasUnchangedLocation({
            boardId: args.boardId,
            organizationId: args.organizationId,
            postId: args.id,
            statusId: args.statusId,
          }),
          participation.canParticipate(args.organizationId)
        ),
    },
  });

  const canUpdateAs = (
    args: TPostUpdateContent | TPostUpdateTitle,
    surface: Surface
  ) =>
    postPolicy.canUpdate({
      boardId: args.boardId,
      organizationId: args.organizationId,
      postId: args.id,
      source: surface,
    });

  // The portal half of an edit is also a participation write: a banned end
  // user can still delete their own post, but cannot keep editing it.
  const canUpdatePublicAs = (args: TPostUpdateContent | TPostUpdateTitle) =>
    Policy.all(
      canUpdateAs(args, "public"),
      participation.canParticipate(args.organizationId)
    );

  const updateContentWrite = defineSurfacePair<
    TPostUpdateContent,
    PostRpcTag
  >()({
    operation: "UpdatePostContent",
    remap: { action: "update", entity: "Post" },
    dashboard: { rateLimit: undefined, policy: canUpdateAs },
    public: { rateLimit: "expensive", policy: canUpdatePublicAs },
  });

  const updateTitleWrite = defineSurfacePair<TPostUpdateTitle, PostRpcTag>()({
    operation: "UpdatePostTitle",
    remap: { action: "update", entity: "Post" },
    dashboard: { rateLimit: undefined, policy: canUpdateAs },
    public: { rateLimit: "expensive", policy: canUpdatePublicAs },
  });

  // Every dashboard write below records an audit entry; the portal halves are
  // end-user actions — the public board is `post_activity`'s timeline, not the
  // workspace's accountability record — and write none. Where the shared write
  // path leaves nothing running after its transaction, the entry goes inside
  // that transaction (the path's own transaction nests as a savepoint in the
  // one opened here) so the entry and the change commit together. `create`,
  // `updatePostContent` and `updatePostTitle` are the exceptions, and each says
  // why where it records.
  const removePost = deleteWrite.handlers((surface, args) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const audit = yield* AuditLogRecorder;

      const write = {
        ...args,
        mayDeleteEngaged: Permissions.can(
          session,
          args.organizationId,
          "posts.*"
        ),
      };

      // The asset sweep runs once the delete has committed, never inside the
      // transaction: it touches storage and the asset table, and a rollback
      // would otherwise leave the post alive with its assets already collected.
      // The delete and its entries stay in the transaction, where they commit
      // together.
      const cleanup = writes.cleanupAfterRemove(args.organizationId);

      if (surface === "public") {
        yield* writes.remove(write, memberActor(session, args.organizationId));
        yield* cleanup;

        return;
      }

      yield* transaction(
        Effect.gen(function* () {
          const removed = yield* writes.remove(
            write,
            memberActor(session, args.organizationId)
          );

          const actor = actorFromSession(session, args.organizationId);
          // The ids the delete removed, not the ids the request asked for:
          // the pre-read and the delete are two statements, and a post that
          // vanished between them must not leave an entry claiming it was
          // deleted.
          yield* Effect.forEach(
            removed.deletedIds,
            (id) =>
              audit.record({
                organizationId: args.organizationId,
                actor,
                source: "dashboard",
                action: "post.deleted",
                resourceId: id,
              }),
            { discard: true }
          );
        })
      );

      yield* cleanup;
    })
  );

  const updatePost = updateWrite.handlers((surface, args) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const audit = yield* AuditLogRecorder;

      return yield* transaction(
        Effect.gen(function* () {
          // Read first, in this transaction, and under the row lock the
          // activity-state read takes: the board and status the post carried
          // are the half of the diff the update no longer knows, and two
          // concurrent saves would otherwise diff from the same stale row.
          let previous:
            | { readonly boardId: string; readonly statusId: string }
            | undefined;

          if (surface === "dashboard") {
            const state = yield* repository.findActivityState({
              id: args.id,
              organizationId: args.organizationId,
            });

            previous =
              state === undefined
                ? undefined
                : { boardId: state.boardId, statusId: state.statusId };
          }

          yield* writes.update(
            {
              boardId: args.boardId,
              id: args.id,
              organizationId: args.organizationId,
              statusId: args.statusId,
            },
            memberActor(session, args.organizationId)
          );

          if (previous === undefined) {
            return;
          }

          const actor = actorFromSession(session, args.organizationId);

          if (previous.boardId !== args.boardId) {
            yield* audit.record({
              organizationId: args.organizationId,
              actor,
              source: "dashboard",
              action: "post.moved",
              resourceId: args.id,
              changes: {
                fields: ["boardId"],
                before: { boardId: previous.boardId },
                after: { boardId: args.boardId },
              },
            });
          }

          if (previous.statusId !== args.statusId) {
            yield* audit.record({
              organizationId: args.organizationId,
              actor,
              source: "dashboard",
              action: "post.status_changed",
              resourceId: args.id,
              changes: {
                fields: ["statusId"],
                before: { statusId: previous.statusId },
                after: { statusId: args.statusId },
              },
            });
          }
        })
      );
    })
  );

  const updatePostContent = updateContentWrite.handlers((surface, args) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const audit = yield* AuditLogRecorder;

      const { contentChanged } = yield* writes.update(
        {
          assetIds: args.assetIds,
          content: args.content,
          expectedUpdatedAt: args.expectedUpdatedAt,
          id: args.id,
          organizationId: args.organizationId,
        },
        memberActor(session, args.organizationId)
      );

      // `contentChanged` is the shared write path's comparison of the stored
      // body against the prepared one — sanitising can make two different
      // submissions the same post — so a save that changed nothing writes no
      // entry.
      if (surface !== "dashboard" || !contentChanged) {
        return;
      }

      // Best effort for the same reason `create` is: a body edit schedules an
      // embedding on a detached fiber, so the entry is written once the edit
      // is durable rather than from inside a transaction that fiber would
      // inherit. The update returns the row it wrote, not the one it replaced,
      // and a post body is far too much data to keep a copy of in the log, so
      // the new body is described rather than diffed.
      yield* audit.recordBestEffort({
        organizationId: args.organizationId,
        actor: actorFromSession(session, args.organizationId),
        source: "dashboard",
        action: "post.updated",
        resourceId: args.id,
        metadata: {
          assetIds: args.assetIds,
          contentLength: args.content.length,
          field: "content",
        },
      });
    })
  );

  const updatePostTitle = updateTitleWrite.handlers((surface, args) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const audit = yield* AuditLogRecorder;

      const { titleChanged } = yield* writes.update(
        {
          id: args.id,
          organizationId: args.organizationId,
          title: args.title,
        },
        memberActor(session, args.organizationId)
      );

      if (surface !== "dashboard" || !titleChanged) {
        return;
      }

      // Best effort, for the reason given on `create` and `updatePostContent`:
      // a title change re-schedules the embedding the same way.
      yield* audit.recordBestEffort({
        organizationId: args.organizationId,
        actor: actorFromSession(session, args.organizationId),
        source: "dashboard",
        action: "post.updated",
        resourceId: args.id,
        metadata: { field: "title", title: args.title },
      });
    })
  );

  // On-behalf attribution is a dashboard capability: the public `canCreate`
  // branch never consults `onBehalf`, and the body below refuses an author
  // outright on the portal, so one factory serves both halves.
  const canCreateAs = (args: TPostCreate, surface: Surface) =>
    postPolicy.canCreate({
      onBehalf: args.author !== undefined,
      organizationId: args.organizationId,
      source: surface,
    });

  const createWrite = defineSurfacePair<TPostCreate, PostRpcTag>()({
    operation: "CreatePost",
    remap: {
      action: "create",
      entity: "Post",
      onUniqueViolation: () =>
        new PostAlreadyExistsError({
          message: "A post with this slug already exists",
        }),
    },
    dashboard: { rateLimit: undefined, policy: canCreateAs },
    public: {
      rateLimit: "expensive",
      policy: (args: TPostCreate) =>
        Policy.all(
          canCreateAs(args, "public"),
          participation.canParticipate(args.organizationId)
        ),
    },
  });

  const createPost = createWrite.handlers((surface, args) =>
    Effect.gen(function* () {
      // On-behalf attribution is dashboard-only; the public portal cannot
      // name a customer and the board's create form does not offer one.
      if (surface === "public" && args.author !== undefined) {
        return yield* new BadRequestError({
          message:
            "Posts cannot be created on behalf of another author from public boards",
        });
      }

      const session = yield* CurrentSession;
      const audit = yield* AuditLogRecorder;

      const slug = yield* writes.create(
        args,
        memberActor(session, args.organizationId),
        surface === "public" ? { source: "PUBLIC_BOARD" } : undefined
      );

      if (surface === "dashboard") {
        // Best effort, and one of the three in this module that are: `create`
        // ends by scheduling the post's embedding on a detached fiber, and a
        // fiber forked inside an outer transaction inherits that transaction's
        // connection. Holding a pooled connection past its transaction for an
        // HTTP call is how one request's write lands on another's connection,
        // so the entry is written once the creation is durable and a failure
        // to write it is logged instead of failing the caller twice.
        yield* audit.recordBestEffort({
          organizationId: args.organizationId,
          actor: actorFromSession(session, args.organizationId),
          source: "dashboard",
          action: "post.created",
          resourceId: args.id,
          metadata: {
            boardId: args.boardId,
            statusId: args.statusId,
            title: args.title,
          },
        });
      }

      return slug;
    })
  );

  // -- One-sided public reads (the dashboard bodies differ) --

  const listPublicEntry = definePublicEntry<TPostList, PostRpcTag>()({
    operation: "ListPosts",
    remap: { action: "select", entity: "Post" },
    config: { rateLimit: "read", policy: () => Policy.allow },
  });

  const getPublicEntry = definePublicEntry<TPostGet, PostRpcTag>()({
    operation: "GetPost",
    remap: { action: "select", entity: "Post" },
    config: { rateLimit: "read", policy: () => Policy.allow },
  });

  const suggestionsPublicEntry = definePublicEntry<
    TPostSuggestions,
    PostRpcTag
  >()({
    operation: "GetPostSuggestions",
    remap: { action: "select", entity: "Post" },
    config: { rateLimit: "expensive", limit: 30, policy: () => Policy.allow },
  });

  const deleteEligibilityPublicEntry = definePublicEntry<
    TPostDeleteEligibilityListPublic,
    PostRpcTag
  >()({
    operation: "ListPostDeleteEligibility",
    remap: { action: "select", entity: "Post" },
    config: { rateLimit: "read", policy: () => Policy.allow },
  });

  // -- RPC handlers --

  return {
    ListPosts: (args: TPostList) => {
      // No per-row delete hints here: `canDeleteAsCreator` probes cost two
      // anti-joins per list fetch while only the caller's own rows can be
      // true. Affordances resolve it on demand via PostDeleteEligibility.
      return repository
        .findMany({
          organizationId: args.organizationId,
          boardId: args.boardId,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Post", "select")
        );
    },

    ListPostsPublic: listPublicEntry.entry((args) =>
      withPublicViewer({
        read: () =>
          repository.findManyPublic({
            organizationId: args.organizationId,
            boardId: args.boardId,
          }),
        redact: redactCreatorIdentities,
      })
    ),

    GetPost: (args: TPostGet) => {
      return Effect.gen(function* () {
        const post = yield* repository.findBySlug({
          organizationId: args.organizationId,
          slug: args.slug,
        });

        if (post === undefined) {
          return yield* new PostNotFoundError({
            message: "Post not found",
          });
        }

        return post;
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Post", "select")
      );
    },

    GetPostPublic: getPublicEntry.entry((args) =>
      // Same visibility rule as ListPostsPublic: board visibility is enforced
      // inside `findPublicBySlug` (public boards only).
      withPublicViewer({
        read: () =>
          Effect.gen(function* () {
            const post = yield* repository.findPublicBySlug({
              organizationId: args.organizationId,
              slug: args.slug,
            });

            if (post === undefined) {
              return yield* new PostNotFoundError({
                message: "Post not found",
              });
            }

            return post;
          }),
        redact: redactCreatorIdentity,
      })
    ),

    GetPostSuggestions: (args: TPostSuggestions) =>
      suggestions({ ...args, publicOnly: false }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Post", "select")
      ),

    ResolveMergedPostPublic: (args: TPostGet) =>
      Effect.gen(function* () {
        const target = yield* repository.findMergedPublicTargetBySlug({
          organizationId: args.organizationId,
          slug: args.slug,
        });

        return target?.slug ?? null;
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ResolveMergedPostPublic",
          level: "read",
        }),
        withRemapDbErrors("Post", "select")
      ),

    GetPostSuggestionsPublic: suggestionsPublicEntry.entry((args) =>
      withPublicViewer({
        read: () => suggestions({ ...args, publicOnly: true }),
        redact: redactCreatorIdentities,
      })
    ),

    DeletePost: removePost.dashboard,

    DeletePostPublic: removePost.public,

    ListPostDeleteEligibility: (args: TPostDeleteEligibilityList) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;

        const rows = yield* repository.findDeletableIds({
          organizationId: args.organizationId,
          userId: session.session.userId,
        });

        return { eligibleIds: rows.map((row) => row.id) };
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Post", "select")
      ),

    ListPostDeleteEligibilityPublic: deleteEligibilityPublicEntry.entry(
      (args) =>
        Effect.gen(function* () {
          const viewer = yield* currentPublicViewer;

          if (viewer.userId === undefined) {
            return { eligibleIds: [] };
          }

          const rows = yield* repository.findDeletableIds({
            organizationId: args.organizationId,
            userId: viewer.userId,
          });

          return { eligibleIds: rows.map((row) => row.id) };
        })
    ),

    UpdatePost: updatePost.dashboard,

    UpdatePostPublic: updatePost.public,

    UpdatePostContent: updatePostContent.dashboard,

    UpdatePostTitle: updatePostTitle.dashboard,

    UpdatePostContentPublic: updatePostContent.public,

    UpdatePostTitlePublic: updatePostTitle.public,

    CreatePost: createPost.dashboard,

    CreatePostPublic: createPost.public,

    UpdatePostEta: (args: TPostUpdateEta) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        yield* transaction(
          Effect.gen(function* () {
            const { etaChanged } = yield* writes.update(
              {
                etaQuarter: args.etaQuarter,
                id: args.id,
                organizationId: args.organizationId,
              },
              memberActor(session, args.organizationId)
            );

            // Re-saving the same quarter changes nothing, and the entry would
            // claim an edit the row never had.
            if (!etaChanged) {
              return;
            }

            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post.updated",
              resourceId: args.id,
              metadata: { etaQuarter: args.etaQuarter, field: "etaQuarter" },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          postPolicy.canUpdateEta({
            organizationId: args.organizationId,
            postId: args.id,
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    UpdatePostAuthor: (args: TPostUpdateAuthor) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        yield* transaction(
          Effect.gen(function* () {
            yield* updatePostAuthorEffect(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post.updated",
              resourceId: args.id,
              metadata: { author: args.author, field: "author" },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          postPolicy.canUpdateAuthor({
            organizationId: args.organizationId,
            postId: args.id,
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    UpdatePostAssignee: (args: TPostUpdateAssignee) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        yield* transaction(
          Effect.gen(function* () {
            const { assigneeChanged } = yield* writes.update(
              {
                assigneeMemberId: args.assigneeMemberId,
                id: args.id,
                organizationId: args.organizationId,
              },
              memberActor(session, args.organizationId)
            );

            if (!assigneeChanged) {
              return;
            }

            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post.updated",
              resourceId: args.id,
              metadata: {
                assigneeMemberId: args.assigneeMemberId,
                field: "assignee",
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          postPolicy.canUpdateAssignee({
            organizationId: args.organizationId,
            postId: args.id,
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    AdminUpdatePost: (args: TPostAdminUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            const previous = yield* requireNotMergedActivityState(args);

            const actor = {
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              organizationId: args.organizationId,
              postId: args.id,
            };

            // The activity is emitted on a real move, which is a question for
            // the engagement and presence graphs rather than for the two
            // timestamp columns: `adminUpdate` is an idempotent set, so asking
            // the machine is what keeps "archived twice" from announcing
            // itself twice. The audit entry answers the same question from the
            // same answer, so a no-op admin update writes neither.
            const nextLocked = args.locked;

            const lockedChanged =
              nextLocked !== undefined &&
              engagementOf(previous) !== engagementForLock(nextLocked);

            const nextArchived = args.archived;

            const archivedChanged =
              nextArchived !== undefined &&
              isArchivedPostPresence(presenceOf(previous)) !== nextArchived;

            const activities: PostActivityInput[] = [];

            if (lockedChanged) {
              activities.push({
                ...actor,
                kind: args.locked ? "POST_LOCKED" : "POST_UNLOCKED",
              });
            }

            if (archivedChanged) {
              activities.push({
                ...actor,
                kind: args.archived ? "POST_ARCHIVED" : "POST_UNARCHIVED",
              });
            }

            yield* repository.adminUpdate(args);
            yield* activityRepository.createMany(activities);

            const auditActor = actorFromSession(session, args.organizationId);

            if (lockedChanged) {
              yield* audit.record({
                organizationId: args.organizationId,
                actor: auditActor,
                source: "dashboard",
                action: "post.locked",
                resourceId: args.id,
                changes: {
                  fields: ["locked"],
                  before: {
                    locked: engagementOf(previous) === LOCKED_POST_ENGAGEMENT,
                  },
                  after: { locked: nextLocked },
                },
              });
            }

            if (archivedChanged) {
              yield* audit.record({
                organizationId: args.organizationId,
                actor: auditActor,
                source: "dashboard",
                action: "post.archived",
                resourceId: args.id,
                changes: {
                  fields: ["archived"],
                  before: {
                    archived: isArchivedPostPresence(presenceOf(previous)),
                  },
                  after: { archived: nextArchived },
                },
              });
            }
          })
        );
      }).pipe(
        Policy.withPolicy(
          postPolicy.canAdminUpdate({
            organizationId: args.organizationId,
            postId: args.id,
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PublishPostOfficialUpdate: (args: TPostOfficialUpdatePublish) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const audit = yield* AuditLogRecorder;
        // An official update is a timeline event only. It used to also email
        // post subscribers; that notification is gone with the three-email
        // model, so the write stands alone.
        yield* transaction(
          Effect.gen(function* () {
            yield* requireNotMergedActivityState({
              id: args.postId,
              organizationId: args.organizationId,
            });
            yield* activityRepository.create({
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              id: args.updateId,
              kind: "OFFICIAL_UPDATE_PUBLISHED",
              body: args.body,
              organizationId: args.organizationId,
              postId: args.postId,
            });
            // The catalog has no verb for a published official update, so the
            // post-level change is recorded under the closest declared verb
            // and the timeline entry it wrote is named in `metadata`.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post.updated",
              resourceId: args.postId,
              metadata: {
                field: "officialUpdate",
                updateId: args.updateId,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          postPolicy.canAdminUpdate({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    MergePost: (args: TPostMerge) =>
      Effect.gen(function* () {
        if (args.sourcePostId === args.targetPostId) {
          return yield* new BadRequestError({
            message: "Source and target posts must be different",
          });
        }

        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        // The move, the two timeline entries, the notification, and the email
        // intent are the shared write path (`post/write.ts`), so a merge
        // performed from the dashboard and one performed with an API key
        // cannot drift; only the actor differs.
        yield* transaction(
          Effect.gen(function* () {
            yield* writes.merge(
              args,
              memberActor(session, args.organizationId)
            );
            // The archived post is the one that stopped being its own page, so
            // it is the resource; the survivor it was folded into is context.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post.merged",
              resourceId: args.sourcePostId,
              metadata: { targetPostId: args.targetPostId },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(postPolicy.canMerge(args.organizationId)),
        withRemapDbErrors("Post", "update")
      ),

    UnmergePost: (args: TPostUnmerge) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* writes.unmerge(
              args,
              memberActor(session, args.organizationId)
            );
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post.unmerged",
              resourceId: args.sourcePostId,
            });
          })
        );
      }).pipe(
        Policy.withPolicy(postPolicy.canMerge(args.organizationId)),
        withRemapDbErrors("Post", "update")
      ),
  };
});

export const PostRpcHandlers = PostRpcs.toLayer(PostRpcHandlersEffect).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(EmailOutboxRepository.layer),
  Layer.provide(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  ),
  Layer.provide(PostEmbeddingService.layer),
  Layer.provide(ParticipationPolicy.layer),
  Layer.provide(AuditLogRecorder.layer)
);
