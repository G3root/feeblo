import { Effect, Layer } from "effect";
import { InternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { CommentReactionRepository } from "./repository";
import { CommentReactionRpcs } from "./rpcs";
import type { TCommentReactionList, TCommentReactionToggle } from "./schema";

export const CommentReactionRpcHandlers = CommentReactionRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* CommentReactionRepository;

    return {
      CommentReactionList: (args: TCommentReactionList) =>
        repository
          .list({
            organizationId: args.organizationId,
            postId: args.postId,
          })
          .pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list comment reactions",
                })
              ),
          })
        ),
      CommentReactionToggle: (args: TCommentReactionToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            commentId: args.commentId,
            userId: session.session.userId,
            emoji: args.emoji,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to toggle comment reaction",
                })
              ),
          })
        ),
    };
  })
).pipe(Layer.provide(CommentReactionRepository.Default));
