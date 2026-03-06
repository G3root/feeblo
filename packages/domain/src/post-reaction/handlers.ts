import { Effect, Layer } from "effect";
import { onInternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { PostReactionRepository } from "./repository";
import { PostReactionRpcs } from "./rpcs";
import type { TPostReactionList, TPostReactionToggle } from "./schema";

export const PostReactionRpcHandlers = PostReactionRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* PostReactionRepository;

    return {
      PostReactionList: (args: TPostReactionList) =>
        Effect.gen(function* () {
          return yield* repository.list({
            postId: args.postId,
            organizationId: args.organizationId,
          });
        }).pipe(Effect.catchAll(onInternalServerError)),
      PostReactionToggle: (args: TPostReactionToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
            emoji: args.emoji,
          });
        }).pipe(Effect.catchAll(onInternalServerError)),
    };
  })
).pipe(Layer.provide(PostReactionRepository.Default));
