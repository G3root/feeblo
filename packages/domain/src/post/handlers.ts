import { Effect, Layer } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { PostRepository } from "./repository";
import { PostRpcs } from "./rpcs";

export const PostRpcHandlers = PostRpcs.middleware(AuthMiddleware)
  .toLayer(
    Effect.gen(function* () {
      const repository = yield* PostRepository;

      return {
        PostList: () => repository.findMany.pipe(Effect.orDie),
        PostDelete: ({ id }: { id: string }) =>
          repository.delete(id).pipe(Effect.orDie),
      };
    })
  )
  .pipe(Layer.provide(PostRepository.Default));
