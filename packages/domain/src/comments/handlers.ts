import { transaction } from "@feeblo/db";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { NotificationService } from "../notification/service";
import * as Policy from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import {
  FailedToDeleteCommentError,
  FailedToPinCommentError,
  FailedToUnpinCommentError,
  FailedToUpdateCommentError,
} from "./errors";
import { CommentPolicy } from "./policies";
import { CommentRepository } from "./repository";
import { CommentRpcs } from "./rpcs";
import type {
  TCommentCreate,
  TCommentDelete,
  TCommentList,
  TCommentPin,
  TCommentUnpin,
  TCommentUpdate,
} from "./schema";

export const CommentRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CommentRepository;
  const activityRepository = yield* PostActivityRepository;
  const commentPolicy = yield* CommentPolicy;
  // const sitePolicy = yield* SitePolicy;

  const notifications = yield* Effect.serviceOption(NotificationService);

  // -- Shared effect helpers (no policy applied) --

  const createCommentEffect = (args: TCommentCreate) => {
    const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
    return Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      yield* transaction(
        Effect.gen(function* () {
          yield* repository.create({
            ...args,
            content: sanitizedMarkdown,
            userId: session.session.userId,
            ...(membership && { memberId: membership.membershipId }),
          });

          yield* activityRepository.create({
            organizationId: args.organizationId,
            postId: args.postId,
            actorId: session.session.userId,
            actorMemberId: membership?.membershipId ?? null,
            kind: "COMMENT_CREATED",
            commentId: args.id,
            visibility: args.visibility,
          });

          yield* Option.match(notifications, {
            onNone: () => Effect.void,
            onSome: (service) =>
              service.notifyComment({
                organizationId: args.organizationId,
                postId: args.postId,
                commentId: args.id,
                actorUserId: session.session.userId,
              }),
          });
        })
      );

      return {
        message: "Comment created successfully",
      };
    });
  };

  const deleteCommentEffect = (args: TCommentDelete) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      const deletedComment = yield* transaction(
        Effect.gen(function* () {
          const deleted = yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
          });
          if (deleted) {
            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "COMMENT_DELETED",
              commentId: args.id,
            });
          }
          return deleted;
        })
      );

      if (!deletedComment) {
        return yield* new FailedToDeleteCommentError({
          message: "Failed to delete comment",
        });
      }

      return {
        message: "Comment deleted successfully",
      };
    });

  const updateCommentEffect = (args: TCommentUpdate) => {
    const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
    return Effect.gen(function* () {
      const session = yield* CurrentSession;

      const membership = Policy.getMembership(session, args.organizationId);

      //only members can update visibility
      const updatedComment = yield* transaction(
        Effect.gen(function* () {
          const updated = yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            content: sanitizedMarkdown,
            userId: session.session.userId,
            ...(membership && { visibility: args.visibility }),
          });
          if (updated) {
            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "COMMENT_UPDATED",
              commentId: args.id,
              visibility: membership ? args.visibility : null,
            });
          }
          return updated;
        })
      );

      if (!updatedComment) {
        return yield* new FailedToUpdateCommentError({
          message: "Failed to update comment",
        });
      }

      return {
        message: "Comment updated successfully",
      };
    });
  };

  const pinCommentEffect = (args: TCommentPin) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      const pinned = yield* transaction(
        Effect.gen(function* () {
          const result = yield* repository.pin({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
          });
          if (Option.isSome(result)) {
            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "COMMENT_PINNED",
              commentId: args.id,
            });
          }
          return result;
        })
      );

      if (Option.isNone(pinned)) {
        return yield* new FailedToPinCommentError({
          message: "Failed to pin comment",
        });
      }

      return {
        message: "Comment pinned successfully",
      };
    });

  const unpinCommentEffect = (args: TCommentUnpin) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      const unpinned = yield* transaction(
        Effect.gen(function* () {
          const result = yield* repository.unpin({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
          });
          if (result) {
            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "COMMENT_UNPINNED",
              commentId: args.id,
            });
          }
          return result;
        })
      );

      if (!unpinned) {
        return yield* new FailedToUnpinCommentError({
          message: "Failed to unpin comment",
        });
      }

      return {
        message: "Comment unpinned successfully",
      };
    });

  // -- RPC handlers --

  return {
    CommentList: (args: TCommentList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
          slug: args.slug,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Comment", "select")
        ),

    CommentListPublic: (args: TCommentList) =>
      Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        const isMember = Option.match(sessionOption, {
          onNone: () => false,
          onSome: (session) => Policy.isMember(session, args.organizationId),
        });
        const sessionUserId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;

        const comments = yield* repository.findManyPublic({
          organizationId: args.organizationId,
          slug: args.slug,
          includeInternal: isMember,
        });

        // Never leak internal commenter identifiers to public callers.
        return redactActorIdentities(comments, sessionUserId);
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentListPublic",
          level: "read",
        }),
        withRemapDbErrors("Comment", "select")
      ),

    CommentCreate: (args: TCommentCreate) =>
      createCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
            postId: args.postId,
            parentCommentId: args.parentCommentId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "create")
      ),

    CommentCreatePublic: (args: TCommentCreate) =>
      createCommentEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentCreatePublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          commentPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
            postId: args.postId,
            parentCommentId: args.parentCommentId,
            source: "public",
          })
        ),
        withRemapDbErrors("Comment", "create")
      ),

    CommentDelete: (args: TCommentDelete) =>
      deleteCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canDelete({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "delete")
      ),

    CommentDeletePublic: (args: TCommentDelete) =>
      deleteCommentEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentDeletePublic",
          level: "write",
        }),
        Policy.withPolicy(
          commentPolicy.canDelete({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "public",
          })
        ),
        withRemapDbErrors("Comment", "delete")
      ),

    CommentUpdate: (args: TCommentUpdate) =>
      updateCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canUpdate({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,

            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "update")
      ),

    CommentUpdatePublic: (args: TCommentUpdate) =>
      updateCommentEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentUpdatePublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          commentPolicy.canUpdate({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "public",
          })
        ),
        withRemapDbErrors("Comment", "update")
      ),

    CommentPin: (args: TCommentPin) =>
      pinCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canPin({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "update")
      ),

    CommentUnpin: (args: TCommentUnpin) =>
      unpinCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canPin({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "update")
      ),
  };
});

export const CommentRpcHandlers = CommentRpcs.toLayer(
  CommentRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(CommentPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(NotificationService.layer)
);
