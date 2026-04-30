import { Effect, Layer } from "effect";
import { BoardRepository } from "../board/repository";
import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
import { sanitizeRichText } from "../sanitize-html";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import {
  FailedToCreatePostError,
  FailedToDeletePostError,
  FailedToUpdatePostError,
} from "./errors";
import { PostPolicy } from "./policies";
import { PostRepository } from "./repository";
import { PostRpcs } from "./rpcs";
import type {
  TPostCreate,
  TPostDelete,
  TPostList,
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
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list posts" })
              ),
          })
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
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list posts" })
              ),
          })
        );
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
            Effect.catchTags({
              SqlError: () => Effect.fail(new FailedToDeletePostError()),
            })
          );
      },
      PostUpdate: (args: TPostUpdate) => {
        return repository
          .update({ ...args, content: sanitizeRichText(args.content) })
          .pipe(
            Policy.withPolicy(
              postPolicy.isOwner({
                organizationId: args.organizationId,
                postId: args.id,
                boardId: args.boardId,
              })
            ),
            Effect.catchTags({
              SqlError: () => Effect.fail(new FailedToUpdatePostError()),
            })
          );
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
        }).pipe(
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToCreatePostError()),
          })
        );
      },
    };
  })
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(BoardRepository.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer)
);
