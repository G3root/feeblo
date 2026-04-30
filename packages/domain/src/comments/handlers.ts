import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { PostRepository } from "../post/repository";
import { InternalServerError } from "../rpc-errors";
import { sanitizeRichText } from "../sanitize-html";
import { CurrentSession } from "../session-middleware";
import {
  FailedToCreateCommentError,
  FailedToDeleteCommentError,
  FailedToUpdateCommentError,
} from "./errors";
import { CommentPolicy } from "./policies";
import { CommentRepository } from "./repository";
import { CommentRpcs } from "./rpcs";
import type {
  TCommentCreate,
  TCommentDelete,
  TCommentList,
  TCommentUpdate,
} from "./schema";

export const CommentRpcHandlers = CommentRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* CommentRepository;
    const commentPolicy = yield* CommentPolicy;
    const postRepository = yield* PostRepository;
    // const sitePolicy = yield* SitePolicy;

    return {
      CommentList: (args: TCommentList) =>
        repository
          .findMany({
            organizationId: args.organizationId,
            postId: args.postId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            Effect.catchTags({
              SqlError: () =>
                Effect.fail(
                  new InternalServerError({
                    message: "Failed to list comments",
                  })
                ),
            })
          ),
      CommentListPublic: (args: TCommentList) =>
        Effect.gen(function* () {
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.findManyPublic({
            organizationId: args.organizationId,
            postId: args.postId,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list comments",
                })
              ),
          })
        ),
      CommentCreate: (args: TCommentCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const membership = Policy.getMembership(session, args.organizationId);

          const isPublicPost = yield* postRepository.isPublicPost({
            id: args.postId,
            organizationId: args.organizationId,
          });

          if (!membership && (args.visibility !== "PUBLIC" || !isPublicPost)) {
            return yield* new Policy.PolicyDeniedError({
              reason: "You are not allowed to comment on this post.",
            });
          }

          yield* repository.create({
            ...args,
            content: sanitizeRichText(args.content),
            userId: session.session.userId,
            ...(membership ? { memberId: membership.membershipId } : {}),
          });

          return {
            message: "Comment created successfully",
          };
        }).pipe(
          Policy.withPolicy(
            commentPolicy.canCreate({
              organizationId: args.organizationId,
              visibility: args.visibility,
            })
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new FailedToCreateCommentError({
                  message: "Failed to create comment",
                })
              ),
          })
        );
      },
      CommentDelete: (args: TCommentDelete) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          const deletedComment = yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          });

          if (!deletedComment) {
            return yield* new FailedToDeleteCommentError({
              message: "Failed to delete comment",
            });
          }

          return {
            message: "Comment deleted successfully",
          };
        }).pipe(
          Policy.withPolicy(
            commentPolicy.isOwner({
              organizationId: args.organizationId,
              commentId: args.id,
              postId: args.postId,
            })
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new FailedToDeleteCommentError({
                  message: "Failed to delete comment",
                })
              ),
          })
        );
      },
      CommentUpdate: (args: TCommentUpdate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const updatedComment = yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            content: sanitizeRichText(args.content),
            userId: session.session.userId,
          });

          if (!updatedComment) {
            return yield* new FailedToUpdateCommentError({
              message: "Failed to update comment",
            });
          }

          return {
            message: "Comment updated successfully",
          };
        }).pipe(
          Policy.withPolicy(
            commentPolicy.isOwner({
              organizationId: args.organizationId,
              commentId: args.id,
              postId: args.postId,
            })
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new FailedToUpdateCommentError({
                  message: "Failed to update comment",
                })
              ),
          })
        );
      },
    };
  })
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentPolicy.layer),
  Layer.provide(CommentRepository.layer)
);
