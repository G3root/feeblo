import { Effect, Layer } from "effect";
import { requireOrganizationMembership } from "../authorization";
import { mapToInternalServerError, UnauthorizedError } from "../rpc-errors";
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
          yield* requireOrganizationMembership(args.organizationId);
          const session = yield* CurrentSession;

          return yield* repository.list({
            postId: args.postId,
            userId: session.session.userId,
            organizationId: args.organizationId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError))),
      UpvoteToggle: (args: TUpvoteToggle) =>
        Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          const session = yield* CurrentSession;

          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError))),
    };
  })
).pipe(Layer.provide(UpvoteRepository.Default));
