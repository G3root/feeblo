import { Effect, Layer } from "effect";
import { CurrentSession } from "../session-middleware";
import { PostRepository } from "./repository";
import { PostRpcs } from "./rpcs";
import type { TPostDelete, TPostList } from "./schema";

export const PostRpcHandlers = PostRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* PostRepository;

    return {
      PostList: (args: TPostList) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.findMany({
            organizationId: session.session.activeOrganizationId,
            boardId: args.boardId,
          });
        }).pipe(Effect.orDie);
      },
      PostDelete: (args: TPostDelete) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.delete({
            id: args.id,
            organizationId: session.session.activeOrganizationId,
            boardId: args.boardId,
          });
        }).pipe(Effect.orDie);
      },
    };
  })
).pipe(Layer.provide(PostRepository.Default));
