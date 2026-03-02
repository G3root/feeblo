import { Effect, Layer } from "effect";
import {
  isMemberOfOrganization,
  requireOrganizationMembership,
} from "../authorization";
import { mapToInternalServerError, UnauthorizedError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
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

    return {
      PostList: (args: TPostList) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);

          return yield* repository.findMany({
            organizationId: args.organizationId,
            boardId: args.boardId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
      PostListPublic: (args: TPostList) => {
        return Effect.gen(function* () {
          return yield* repository.findMany({
            organizationId: args.organizationId,
            boardId: args.boardId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError()));
      },
      PostDelete: (args: TPostDelete) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);

          return yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
            boardId: args.boardId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
      PostUpdate: (args: TPostUpdate) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          yield* repository.update(args);
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
      PostCreate: (args: TPostCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const isMember = yield* isMemberOfOrganization(args.organizationId);
          yield* repository.create({
            ...args,
            creatorId: session.session.userId,
            ...(isMember ? { creatorMemberId: isMember.id } : {}),
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
    };
  })
).pipe(Layer.provide(PostRepository.Default));
