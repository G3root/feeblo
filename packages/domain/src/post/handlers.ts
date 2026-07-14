import { transaction } from "@feeblo/db";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BoardRepository } from "../board/repository";
import * as Policy from "../policy";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
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
    const postPolicy = yield* PostPolicy;
    // const sitePolicy = yield* SitePolicy;
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
      PostDelete: (args: TPostDelete) => {
        return repository
          .delete({
            id: args.id,
            organizationId: args.organizationId,
            boardId: args.boardId,
          })
          .pipe(
            Policy.withPolicy(
              postPolicy.isOwner({
                organizationId: args.organizationId,
                postId: args.id,
                boardId: args.boardId,
              })
            ),
            withRemapDbErrors("Post", "delete")
          );
      },
      PostUpdate: (args: TPostUpdate) => {
        const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
          args.content
        );
        return repository
          .update({
            ...args,
            content: sanitizedMarkdown,
            excerpt: htmlToExcerpt(sanitizedHtml),
          })
          .pipe(
            Policy.withPolicy(
              postPolicy.isOwner({
                organizationId: args.organizationId,
                postId: args.id,
                boardId: args.boardId,
              })
            ),
            withRemapDbErrors("Post", "update")
          );
      },
      PostCreate: (args: TPostCreate) => {
        return Effect.gen(function* () {
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

          console.log("sanitizedMarkdown", sanitizedMarkdown);
          console.log("sanitizedHtml", sanitizedHtml);

          yield* transaction(
            Effect.gen(function* () {
              yield* repository.create({
                ...args,
                content: sanitizedMarkdown,
                excerpt: htmlToExcerpt(sanitizedHtml),
                creatorId: session.session.userId,
                ...(membership
                  ? { creatorMemberId: membership.membershipId }
                  : {}),
              });

              // The creator of a post is automatically subscribed to it.
              yield* subscriptionRepository.subscribe({
                organizationId: args.organizationId,
                postId: args.id,
                userId: session.session.userId,
                ...(membership ? { memberId: membership.membershipId } : {}),
              });
            })
          );
        }).pipe(withRemapDbErrors("Post", "create"));
      },
      PostAdminUpdate: (args: TPostAdminUpdate) =>
        repository
          .adminUpdate(args)
          .pipe(
            Policy.withPolicy(
              postPolicy.isOrganizationOwnerOrAdmin(args.organizationId)
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
          return yield* repository.merge(args);
        }).pipe(
          Policy.withPolicy(
            postPolicy.isOrganizationOwnerOrAdmin(args.organizationId)
          ),
          withRemapDbErrors("Post", "update")
        ),
    };
  });

export const PostRpcHandlers = PostRpcs.toLayer(PostRpcHandlersEffect).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(BoardRepository.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(PostSubscriptionRepository.layer)
);
