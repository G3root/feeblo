import { Effect, Layer } from "effect";
import * as Policy from "../policy";
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

    return {
      CommentList: (args: TCommentList) => {
        return Effect.gen(function* () {
          return yield* repository.findMany({
            organizationId: args.organizationId,
            postId: args.postId,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list comments" })
              ),
          })
        );
      },
      CommentListPublic: (args: TCommentList) => {
        return Effect.gen(function* () {
          return yield* repository.findMany({
            organizationId: args.organizationId,
            postId: args.postId,
            visibility: "PUBLIC",
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list comments" })
              ),
          })
        );
      },
      CommentCreate: (args: TCommentCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          const isMember = session.memberships.find(
            (membership) => membership.organizationId === args.organizationId
          );

          yield* repository.create({
            ...args,
            content: sanitizeRichText(args.content),
            userId: session.session.userId,
            ...(isMember ? { memberId: isMember.membershipId } : {}),
          });

          return {
            message: "Comment created successfully",
          };
        }).pipe(
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

          yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          });
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
          yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            content: sanitizeRichText(args.content),
            userId: session.session.userId,
          });
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
  Layer.provide(CommentPolicy.Default),
  Layer.provide(CommentRepository.Default)
);
