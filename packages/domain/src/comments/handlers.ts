import { transaction } from "@feeblo/db";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import {
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
    const postPolicy = yield* PostPolicy;
    const postRepository = yield* PostRepository;
    // const sitePolicy = yield* SitePolicy;

    const subscriptionRepository = yield* PostSubscriptionRepository;

    return {
      CommentList: (args: TCommentList) =>
        repository
          .findMany({
            organizationId: args.organizationId,
            postId: args.postId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Comment", "select")
          ),
      CommentListPublic: (args: TCommentList) =>
        repository
          .findManyPublic({
            organizationId: args.organizationId,
            postId: args.postId,
          })
          .pipe(withRemapDbErrors("Comment", "select")),
      CommentCreate: (args: TCommentCreate) => {
        const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
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

          yield* transaction(
            Effect.gen(function* () {
              yield* repository.create({
                ...args,
                content: sanitizedMarkdown,
                userId: session.session.userId,
                ...(membership ? { memberId: membership.membershipId } : {}),
              });

              // Commenting on a post automatically subscribes the user to it.
              yield* subscriptionRepository.subscribe({
                organizationId: args.organizationId,
                postId: args.postId,
                userId: session.session.userId,
                ...(membership ? { memberId: membership.membershipId } : {}),
              });
            })
          );

          return {
            message: "Comment created successfully",
          };
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              postPolicy.isUnlocked({
                organizationId: args.organizationId,
                postId: args.postId,
              }),
              commentPolicy.canCreate({
                organizationId: args.organizationId,
                visibility: args.visibility,
              })
            )
          ),
          withRemapDbErrors("Comment", "create")
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
            Policy.all(
              postPolicy.isUnlocked({
                organizationId: args.organizationId,
                postId: args.postId,
              }),
              commentPolicy.isOwner({
                organizationId: args.organizationId,
                commentId: args.id,
                postId: args.postId,
              })
            )
          ),
          withRemapDbErrors("Comment", "delete")
        );
      },
      CommentUpdate: (args: TCommentUpdate) => {
        const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const membership = Policy.getMembership(session, args.organizationId);

          //Todo turn into a policy
          if (!membership) {
            const existing = yield* repository.findById({
              id: args.id,
              organizationId: args.organizationId,
              postId: args.postId,
              userId: session.session.userId,
            });
            if (
              Option.isSome(existing) &&
              existing.value.visibility !== args.visibility
            ) {
              return yield* new Policy.PolicyDeniedError({
                reason: "You are not allowed to change comment visibility.",
              });
            }
          }

          const updatedComment = yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            content: sanitizedMarkdown,
            userId: session.session.userId,
            ...(membership ? { visibility: args.visibility } : {}),
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
            Policy.all(
              postPolicy.isUnlocked({
                organizationId: args.organizationId,
                postId: args.postId,
              }),
              commentPolicy.isOwner({
                organizationId: args.organizationId,
                commentId: args.id,
                postId: args.postId,
              })
            )
          ),
          withRemapDbErrors("Comment", "update")
        );
      },
    };
  })
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(CommentPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentRepository.layer),
  Layer.provide(PostSubscriptionRepository.layer)
);
