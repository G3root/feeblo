import { Effect, Layer } from "effect";
import { requireOrganizationMembership } from "../authorization";
import { mapToInternalServerError, UnauthorizedError } from "../rpc-errors";
import { PostRepository } from "./repository";
import { PostRpcs } from "./rpcs";
import type { TPostDelete, TPostList } from "./schema";

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
    };
  })
).pipe(Layer.provide(PostRepository.Default));
