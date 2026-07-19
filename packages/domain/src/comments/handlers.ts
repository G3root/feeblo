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

export const CommentRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CommentRepository;
  const commentPolicy = yield* CommentPolicy;
  const postPolicy = yield* PostPolicy;
  // const sitePolicy = yield* SitePolicy;

  const subscriptionRepository = yield* PostSubscriptionRepository;

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
    });
  };

  const deleteCommentEffect = (args: TCommentDelete) =>
    Effect.gen(function* () {
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
    });

  const updateCommentEffect = (
    args: TCommentUpdate,
    opts: { allowNonMemberPublic?: boolean } = {}
  ) => {
    const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
    return Effect.gen(function* () {
      const session = yield* CurrentSession;

      if (opts.allowNonMemberPublic) {
        const updatedComment = yield* repository.update({
          id: args.id,
          organizationId: args.organizationId,
          postId: args.postId,
          content: sanitizedMarkdown,
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
      }

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
    });
  };

  // -- RPC handlers --

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

    CommentCreate: (args: TCommentCreate) =>
      createCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
            postId: args.postId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "create")
      ),

    CommentCreatePublic: (args: TCommentCreate) =>
      createCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
            postId: args.postId,
            source: "public",
          })
        ),
        withRemapDbErrors("Comment", "create")
      ),

    CommentDelete: (args: TCommentDelete) =>
      deleteCommentEffect(args).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
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
      ),

    CommentDeletePublic: (args: TCommentDelete) =>
      deleteCommentEffect(args).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(args.organizationId),
            postPolicy.isUnlockedPublic({
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
      ),

    CommentUpdate: (args: TCommentUpdate) =>
      updateCommentEffect(args).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
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
      ),

    CommentUpdatePublic: (args: TCommentUpdate) =>
      updateCommentEffect(args, { allowNonMemberPublic: true }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(args.organizationId),
            postPolicy.isUnlockedPublic({
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
      ),
  };
});

export const CommentRpcHandlers = CommentRpcs.toLayer(
  CommentRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(CommentPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentRepository.layer),
  Layer.provide(PostSubscriptionRepository.layer)
);
