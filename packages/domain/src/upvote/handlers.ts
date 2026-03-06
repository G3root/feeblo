import { Effect, Layer } from "effect";
import { onInternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { UpvoteRepository } from "./repository";
import { UpvoteRpcs } from "./rpcs";
import type { TUpvoteList, TUpvoteToggle } from "./schema";

export const UpvoteRpcHandlers = UpvoteRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* UpvoteRepository;

    return {
      UpvoteList: (args: TUpvoteList) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.list({
            postId: args.postId,
            userId: session.session.userId,
            organizationId: args.organizationId,
          });
        }).pipe(Effect.catchAll(onInternalServerError)),
      UpvoteToggle: (args: TUpvoteToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          });
        }).pipe(Effect.catchAll(onInternalServerError)),
    };
  })
).pipe(Layer.provide(UpvoteRepository.Default));
