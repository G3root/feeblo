import { Effect, Layer } from "effect";
import { requireOrganizationMembership } from "../authorization";
import { mapToInternalServerError, UnauthorizedError } from "../rpc-errors";
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
          yield* requireOrganizationMembership(args.organizationId);

          return yield* repository.list({
            postId: args.postId,
            organizationId: args.organizationId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError))),
      PostReactionToggle: (args: TPostReactionToggle) =>
        Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          const session = yield* CurrentSession;

          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
            emoji: args.emoji,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError))),
    };
  })
).pipe(Layer.provide(PostReactionRepository.Default));
