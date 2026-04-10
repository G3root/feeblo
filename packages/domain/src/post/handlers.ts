import { Effect, Layer } from "effect";
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
    const repository = yield* PostRepository;
    const postPolicy = yield* PostPolicy;
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
          return yield* repository.findMany({
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
              Policy.all(
                Policy.hasMembership(args.organizationId),
                postPolicy.isOwner({
                  organizationId: args.organizationId,
                  postId: args.id,
                  boardId: args.boardId,
                })
              )
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
              Policy.all(
                Policy.hasMembership(args.organizationId),
                postPolicy.isOwner({
                  organizationId: args.organizationId,
                  postId: args.id,
                  boardId: args.boardId,
                })
              )
            ),
            Effect.catchTags({
              SqlError: () => Effect.fail(new FailedToUpdatePostError()),
            })
          );
      },
      PostCreate: (args: TPostCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const isMember = session.memberships.find(
            (membership) => membership.organizationId === args.organizationId
          );

          yield* repository.create({
            ...args,
            content: sanitizeRichText(args.content),
            creatorId: session.session.userId,
            ...(isMember ? { creatorMemberId: isMember.membershipId } : {}),
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
  Layer.provide(PostPolicy.Default),
  Layer.provide(PostRepository.Default)
);
