import { transaction } from "@feeblo/db";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BoardRepository } from "../board/repository";
import { NotificationService } from "../notification/service";
import * as Policy from "../policy";
import {
  type CreatePostActivity,
  PostActivityRepository,
} from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { FailedToUpdatePostError } from "./errors";
import { PostPolicy } from "./policies";
import { PostRepository } from "./repository";
import { PostRpcs } from "./rpcs";
import type {
  TPostAdminUpdate,
  TPostCreate,
  TPostDelete,
  TPostList,
  TPostMerge,
  TPostUpdate,
} from "./schema";

export const PostRpcHandlersEffect = Effect.gen(function* () {
  const boardRepository = yield* BoardRepository;
  const repository = yield* PostRepository;
  const activityRepository = yield* PostActivityRepository;
  const postPolicy = yield* PostPolicy;
  const notifications = yield* Effect.serviceOption(NotificationService);
  // const sitePolicy = yield* SitePolicy;

  // -- Shared effect helpers (no policy applied) --

  const deletePostEffect = (args: TPostDelete) =>
    repository.delete({
      id: args.id,
      organizationId: args.organizationId,
      boardId: args.boardId,
    });

  const updatePostEffect = (args: TPostUpdate) => {
    const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(args.content);
    return Effect.gen(function* () {
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
          const activities: CreatePostActivity[] = [];
          if (previous.title !== args.title) {
            activities.push({
              ...actor,
              kind: "TITLE_CHANGED",
              previousValue: previous.title,
              nextValue: args.title,
            });
          }
          if (previous.content !== sanitizedMarkdown) {
            activities.push({ ...actor, kind: "CONTENT_CHANGED" });
          }
          if (previous.statusId !== args.statusId) {
            activities.push({
              ...actor,
              kind: "STATUS_CHANGED",
              previousValue: previous.statusId,
              nextValue: args.statusId,
            });
          }
          if (previous.boardId !== args.boardId) {
            activities.push({
              ...actor,
              kind: "BOARD_CHANGED",
              previousValue: previous.boardId,
              nextValue: args.boardId,
            });
          }
          yield* repository.update({
            ...args,
            content: sanitizedMarkdown,
            excerpt: htmlToExcerpt(sanitizedHtml),
          });
          yield* activityRepository.createMany(activities);
          if (previous.statusId !== args.statusId) {
            yield* Option.match(notifications, {
              onNone: () => Effect.void,
              onSome: (service) =>
                service.notifyPostStatusChanged({
                  organizationId: args.organizationId,
                  postId: args.id,
                  ...(membership
                    ? { actorMemberId: membership.membershipId }
                    : {}),
                }),
            });
          }
        })
      );
    });
  };

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

      yield* transaction(
        Effect.gen(function* () {
          yield* repository.create({
            ...args,
            content: sanitizedMarkdown,
            excerpt: htmlToExcerpt(sanitizedHtml),
            creatorId: session.session.userId,
            ...(opts.source ? { source: opts.source } : {}),
            ...(membership ? { creatorMemberId: membership.membershipId } : {}),
          });

          yield* activityRepository.create({
            organizationId: args.organizationId,
            postId: args.id,
            actorId: session.session.userId,
            actorMemberId: membership?.membershipId ?? null,
            kind: "POST_CREATED",
          });

          // The creator of a post is automatically subscribed to it.
          yield* subscriptionRepository.subscribe({
            organizationId: args.organizationId,
            postId: args.id,
            userId: session.session.userId,
            ...(membership ? { memberId: membership.membershipId } : {}),
          });

          yield* repository.enqueueSubmissionNotification({
            postId: args.id,
            organizationId: args.organizationId,
          });

          yield* Option.match(notifications, {
            onNone: () => Effect.void,
            onSome: (service) =>
              service.notifySubmission({
                organizationId: args.organizationId,
                postId: args.id,
                ...(membership
                  ? { actorMemberId: membership.membershipId }
                  : {}),
              }),
          });
        })
      );

      yield* repository
        .scheduleSubmissionNotification(args.organizationId)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to schedule submission notification workflow",
              cause
            ).pipe(
              Effect.annotateLogs({
                postId: args.id,
                organizationId: args.organizationId,
              })
            )
          )
        );
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
        //TODO: comeback later
        // yield* sitePolicy.canViewRoadmap(args.organizationId);
        return yield* repository.findManyPublic({
          organizationId: args.organizationId,
          boardId: args.boardId,
          userId,
        });
      }).pipe(withRemapDbErrors("Post", "select"));
    },

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
          postPolicy.canUpdate({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Post", "update")
      ),

    PostUpdatePublic: (args: TPostUpdate) =>
      updatePostEffect(args).pipe(
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
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Post", "create")
      ),

    PostCreatePublic: (args: TPostCreate) =>
      createPostEffect(args, { source: "PUBLIC_BOARD" }).pipe(
        Policy.withPolicy(
          postPolicy.canCreate({
            organizationId: args.organizationId,
            source: "public",
          })
        ),
        withRemapDbErrors("Post", "create")
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
            const activities: CreatePostActivity[] = [];
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

    PostMerge: (args: TPostMerge) =>
      Effect.gen(function* () {
        if (args.sourcePostId === args.targetPostId) {
          return yield* new BadRequestError({
            message: "Source and target posts must be different",
          });
        }
        return yield* repository.merge(args);
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
  Layer.provide(NotificationService.layer)
);
