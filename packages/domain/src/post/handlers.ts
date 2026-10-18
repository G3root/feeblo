import { transaction } from "@feeblo/db";
import * as Permissions from "@feeblo/permissions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
import { WorkspaceRepository } from "../workspace/repository";
import { PostEmbeddingService } from "./embedding-service";
import {
  FailedToUpdatePostError,
  PostAlreadyExistsError,
  PostNotFoundError,
} from "./errors";
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
  const entitlementPolicy = yield* EntitlementPolicy;
  const embeddingService = yield* Effect.serviceOption(PostEmbeddingService);
  // const sitePolicy = yield* SitePolicy;

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
        (post) => post.mergedIntoPostId === null,
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
          })
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

  const updateContentWrite = defineSurfacePair<
    TPostUpdateContent,
    PostRpcTag
  >()({
    operation: "UpdatePostContent",
    remap: { action: "update", entity: "Post" },
    dashboard: { rateLimit: undefined, policy: canUpdateAs },
    public: { rateLimit: "expensive", policy: canUpdateAs },
  });

  const updateTitleWrite = defineSurfacePair<TPostUpdateTitle, PostRpcTag>()({
    operation: "UpdatePostTitle",
    remap: { action: "update", entity: "Post" },
    dashboard: { rateLimit: undefined, policy: canUpdateAs },
    public: { rateLimit: "expensive", policy: canUpdateAs },
  });

  const removePost = deleteWrite.handlers((_surface, args) =>
    Effect.flatMap(CurrentSession, (session) =>
      writes.remove(
        {
          ...args,
          mayDeleteEngaged: Permissions.can(
            session,
            args.organizationId,
            "posts.*"
          ),
        },
        memberActor(session, args.organizationId)
      )
    )
  );

  const updatePost = updateWrite.handlers((_surface, args) =>
    Effect.flatMap(CurrentSession, (session) =>
      writes.update(
        {
          boardId: args.boardId,
          id: args.id,
          organizationId: args.organizationId,
          statusId: args.statusId,
        },
        memberActor(session, args.organizationId)
      )
    )
  );

  const updatePostContent = updateContentWrite.handlers((_surface, args) =>
    Effect.flatMap(CurrentSession, (session) =>
      writes.update(
        {
          assetIds: args.assetIds,
          content: args.content,
          id: args.id,
          organizationId: args.organizationId,
        },
        memberActor(session, args.organizationId)
      )
    )
  );

  const updatePostTitle = updateTitleWrite.handlers((_surface, args) =>
    Effect.flatMap(CurrentSession, (session) =>
      writes.update(
        {
          id: args.id,
          organizationId: args.organizationId,
          title: args.title,
        },
        memberActor(session, args.organizationId)
      )
    )
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
    public: { rateLimit: "expensive", policy: canCreateAs },
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

      return yield* writes.create(
        args,
        memberActor(session, args.organizationId),
        surface === "public" ? { source: "PUBLIC_BOARD" } : undefined
      );
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
      Effect.gen(function* () {
        // A board the plan lock took offline is not publicly readable, so its
        // posts are excluded from the list rather than filtered afterward:
        // the exclusion stays inside the query, and paging stays correct.
        const lockedBoardIds = yield* entitlementPolicy.listLockedBoardIds(
          args.organizationId
        );

        return yield* withPublicViewer({
          read: () =>
            repository.findManyPublic({
              organizationId: args.organizationId,
              boardId: args.boardId,
              excludeBoardIds: [...lockedBoardIds],
            }),
          redact: redactCreatorIdentities,
        });
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
      // Same visibility rule as ListPostsPublic: board visibility and the
      // plan lock are enforced inside `findPublicBySlug`.
      Effect.gen(function* () {
        const lockedBoardIds = yield* entitlementPolicy.listLockedBoardIds(
          args.organizationId
        );

        return yield* withPublicViewer({
          read: () =>
            Effect.gen(function* () {
              const post = yield* repository.findPublicBySlug({
                organizationId: args.organizationId,
                slug: args.slug,
                excludeBoardIds: [...lockedBoardIds],
              });
              if (post === undefined) {
                return yield* new PostNotFoundError({
                  message: "Post not found",
                });
              }
              return post;
            }),
          redact: redactCreatorIdentity,
        });
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
      Effect.flatMap(CurrentSession, (session) =>
        writes.update(
          {
            etaQuarter: args.etaQuarter,
            id: args.id,
            organizationId: args.organizationId,
          },
          memberActor(session, args.organizationId)
        )
      ).pipe(
        Policy.withPolicy(
          postPolicy.canUpdateEta({
            organizationId: args.organizationId,
            postId: args.id,
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    UpdatePostAuthor: (args: TPostUpdateAuthor) =>
      updatePostAuthorEffect(args).pipe(
        Policy.withPolicy(
          postPolicy.canUpdateAuthor({
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
        yield* transaction(
          Effect.gen(function* () {
            const previous = yield* requireNotMergedActivityState(args);
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
        // The move, the two timeline entries, the notification, and the email
        // intent are the shared write path (`post/write.ts`), so a merge
        // performed from the dashboard and one performed with an API key
        // cannot drift; only the actor differs.
        return yield* writes.merge(
          args,
          memberActor(session, args.organizationId)
        );
      }).pipe(
        Policy.withPolicy(postPolicy.canMerge(args.organizationId)),
        withRemapDbErrors("Post", "update")
      ),

    UnmergePost: (args: TPostUnmerge) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        yield* writes.unmerge(args, memberActor(session, args.organizationId));
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
  Layer.provide(PostEmbeddingService.layer)
);
