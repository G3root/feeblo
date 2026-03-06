import { Effect, Layer } from "effect";
import { onInternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { CommentReactionRepository } from "./repository";
import { CommentReactionRpcs } from "./rpcs";
import type { TCommentReactionList, TCommentReactionToggle } from "./schema";

export const CommentReactionRpcHandlers = CommentReactionRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* CommentReactionRepository;

    return {
      CommentReactionList: (args: TCommentReactionList) =>
        Effect.gen(function* () {
          return yield* repository.list({
            organizationId: args.organizationId,
            postId: args.postId,
          });
        }).pipe(Effect.catchAll(onInternalServerError)),
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
        }).pipe(Effect.catchAll(onInternalServerError)),
    };
  })
).pipe(Layer.provide(CommentReactionRepository.Default));
