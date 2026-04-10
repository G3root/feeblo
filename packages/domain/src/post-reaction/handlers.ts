import { Effect, Layer } from "effect";
import { InternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { PostReactionRepository } from "./repository";
import { PostReactionRpcs } from "./rpcs";
import type { TPostReactionList, TPostReactionToggle } from "./schema";

export const PostReactionRpcHandlers = PostReactionRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* PostReactionRepository;

    return {
      PostReactionList: (args: TPostReactionList) =>
        repository
          .list({
            postId: args.postId,
            organizationId: args.organizationId,
          })
          .pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list post reactions",
                })
              ),
          })
        ),
      PostReactionToggle: (args: TPostReactionToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
            emoji: args.emoji,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to toggle post reaction",
                })
              ),
          })
        ),
    };
  })
).pipe(Layer.provide(PostReactionRepository.Default));
