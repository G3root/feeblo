import { Effect, Layer } from "effect";
import { BoardRepository } from "../board/repository";
import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { sanitizeRichText } from "../sanitize-html";
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

export const PostRpcHandlers = PostRpcs.toLayer(
  Effect.gen(function* () {
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
        return Effect.gen(function* () {
          const sanitizeStartedAt = Date.now();
          const sanitizedContent = sanitizeRichText(args.content);
          const sanitizeDurationMs = Date.now() - sanitizeStartedAt;

          yield* Effect.logInfo("[perf] PostUpdate sanitize complete").pipe(
            Effect.annotateLogs({
              boardId: args.boardId,
              organizationId: args.organizationId,
              postId: args.id,
              sanitizeDurationMs,
            })
          );

          const policyStartedAt = Date.now();
          yield* postPolicy.isOwner({
            organizationId: args.organizationId,
            postId: args.id,
            boardId: args.boardId,
          });
          const policyDurationMs = Date.now() - policyStartedAt;

          yield* Effect.logInfo("[perf] PostUpdate policy complete").pipe(
            Effect.annotateLogs({
              boardId: args.boardId,
              organizationId: args.organizationId,
              policyDurationMs,
              postId: args.id,
            })
          );

          const updateStartedAt = Date.now();
          yield* repository.update({ ...args, content: sanitizedContent });
          const updateDurationMs = Date.now() - updateStartedAt;

          yield* Effect.logInfo("[perf] PostUpdate db update complete").pipe(
            Effect.annotateLogs({
              boardId: args.boardId,
              organizationId: args.organizationId,
              postId: args.id,
              updateDurationMs,
            })
          );
        }).pipe(withRemapDbErrors("Post", "update"));
      },
      PostCreate: (args: TPostCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const membership = Policy.getMembership(session, args.organizationId);
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

          yield* repository.create({
            ...args,
            content: sanitizeRichText(args.content),
            creatorId: session.session.userId,
            ...(membership ? { creatorMemberId: membership.membershipId } : {}),
          });
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
  })
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(BoardRepository.layer),
  Layer.provide(PostRepository.layer)
);
