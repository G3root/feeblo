import { transaction } from "@feeblo/db";
import * as Permissions from "@feeblo/permissions";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { wakeEmailOutboxBestEffort } from "../email-outbox/queue";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import {
  type PostActivityInput,
  PostActivityRepository,
} from "../post-activity/repository";
import { redactCreatorIdentity } from "../public-actor";
import * as RateLimit from "../rate-limit";
import {
  BadRequestError,
  InternalServerError,
  withRemapDbErrors,
} from "../rpc-errors";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
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

export const PostRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostRepository;
  const emailOutbox = yield* EmailOutboxRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const activityRepository = yield* PostActivityRepository;
  const postPolicy = yield* PostPolicy;
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

  // -- RPC handlers --

  return {
    PostList: (args: TPostList) => {
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
        const posts = yield* repository.findManyPublic({
          organizationId: args.organizationId,
          boardId: args.boardId,
        });
        // Creator identifiers are PII (see `public-actor.ts`): keep them only
        // on the session user's own rows so "did I create this" still works.
        return posts.map((post) => redactCreatorIdentity(post, userId));
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostListPublic",
          level: "read",
        }),
        withRemapDbErrors("Post", "select")
      );
    },

    PostGet: (args: TPostGet) => {
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

    PostGetPublic: (args: TPostGet) => {
      return Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        const userId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;
        // Same visibility rule as PostListPublic: board visibility is
        // enforced inside `findPublicBySlug` (public boards only). No
        // site-policy gate needed here.
        const post = yield* repository.findPublicBySlug({
          organizationId: args.organizationId,
          slug: args.slug,
        });
        if (post === undefined) {
          return yield* new PostNotFoundError({
            message: "Post not found",
          });
        }
        // Same PII rule as PostListPublic: creator identifiers are only
        // meaningful for the session user's own row.
        return redactCreatorIdentity(post, userId);
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostGetPublic",
          level: "read",
        }),
        withRemapDbErrors("Post", "select")
      );
    },

    PostSuggestions: (args: TPostSuggestions) =>
      suggestions({ ...args, publicOnly: false }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Post", "select")
      ),

    PostResolveMergedPublic: (args: TPostGet) =>
      Effect.gen(function* () {
        const target = yield* repository.findMergedPublicTargetBySlug({
          organizationId: args.organizationId,
          slug: args.slug,
        });
        return target?.slug ?? null;
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostResolveMergedPublic",
          level: "read",
        }),
        withRemapDbErrors("Post", "select")
      ),

    PostSuggestionsPublic: (args: TPostSuggestions) =>
      Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        const userId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;
        const posts = yield* suggestions({ ...args, publicOnly: true });
        // Same PII rule as PostListPublic: creator identifiers are only
        // meaningful for the session user's own rows.
        return posts.map((post) => redactCreatorIdentity(post, userId));
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostSuggestionsPublic",
          // Embedding + vector search per request — priced like the widget
          // suggest endpoint. The cap is raised above the `expensive`
          // default because the create dialog fires this per debounced
          // keystroke while composing a title.
          level: "expensive",
          limit: 30,
        }),
        withRemapDbErrors("Post", "select")
      ),

    PostDelete: (args: TPostDelete) =>
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
      ).pipe(
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
      ).pipe(
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

    PostDeleteEligibilityList: (args: TPostDeleteEligibilityList) =>
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

    PostDeleteEligibilityListPublic: (args: TPostDeleteEligibilityListPublic) =>
      Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        if (sessionOption._tag === "None") {
          return { eligibleIds: [] };
        }
        const rows = yield* repository.findDeletableIds({
          organizationId: args.organizationId,
          userId: sessionOption.value.session.userId,
        });
        return { eligibleIds: rows.map((row) => row.id) };
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostDeleteEligibilityListPublic",
          level: "read",
        }),
        // No organization-scope policy here, because none can fire on this
        // route: `OptionalAuthMiddlewareLive` reduces a restricted widget-SSO
        // session to `Option.none()`, so the branch above already answers
        // `eligibleIds: []` for one. A scope policy would read that same
        // `None`, treat it as a guest, and allow.
        //
        // What bounds the response is that `creatorId` predicate: a caller only
        // ever sees ids of posts they created, in whatever organization they
        // name. A restricted session confined to its own workspace is therefore
        // the middleware's job, and it is already doing it — if that ever
        // changes to admit restricted sessions, this handler needs a
        // `hasRestrictedOrganizationScope` check alongside the branch above.
        withRemapDbErrors("Post", "select")
      ),

    PostUpdate: (args: TPostUpdate) =>
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
      ).pipe(
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
      ).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostUpdatePublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          Policy.all(
            postPolicy.canUpdate({
              organizationId: args.organizationId,
              postId: args.id,
              boardId: args.boardId,
              source: "public",
            }),
            // Public updates are rename semantics only: a creator must never
            // be able to change their post's status or move it across boards
            // (status changes are reserved for `posts.status` holders).
            postPolicy.hasUnchangedLocation({
              organizationId: args.organizationId,
              postId: args.id,
              boardId: args.boardId,
              statusId: args.statusId,
            })
          )
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostUpdateContent: (args: TPostUpdateContent) =>
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
      ).pipe(
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
      Effect.flatMap(CurrentSession, (session) =>
        writes.update(
          {
            id: args.id,
            organizationId: args.organizationId,
            title: args.title,
          },
          memberActor(session, args.organizationId)
        )
      ).pipe(
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
      ).pipe(
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
      Effect.flatMap(CurrentSession, (session) =>
        writes.update(
          {
            id: args.id,
            organizationId: args.organizationId,
            title: args.title,
          },
          memberActor(session, args.organizationId)
        )
      ).pipe(
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
      Effect.flatMap(CurrentSession, (session) =>
        writes.create(args, memberActor(session, args.organizationId))
      ).pipe(
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
        const session = yield* CurrentSession;
        return yield* writes.create(
          args,
          memberActor(session, args.organizationId),
          { source: "PUBLIC_BOARD" }
        );
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

    PostUpdateAuthor: (args: TPostUpdateAuthor) =>
      updatePostAuthorEffect(args).pipe(
        Policy.withPolicy(
          postPolicy.canUpdateAuthor({
            organizationId: args.organizationId,
            postId: args.id,
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostAdminUpdate: (args: TPostAdminUpdate) =>
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

    PostOfficialUpdatePublish: (args: TPostOfficialUpdatePublish) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const now = yield* DateTime.nowAsDate;
        const outboxId = yield* transaction(
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
                expiresAt: DateTime.fromDateUnsafe(now).pipe(
                  DateTime.addDuration(Duration.days(7)),
                  DateTime.toDate
                ),
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
        Policy.withPolicy(
          postPolicy.canAdminUpdate({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostMerge: (args: TPostMerge) =>
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
        yield* writes.merge(args, memberActor(session, args.organizationId));
      }).pipe(
        Policy.withPolicy(postPolicy.canMerge(args.organizationId)),
        withRemapDbErrors("Post", "update")
      ),

    PostUnmerge: (args: TPostUnmerge) =>
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
