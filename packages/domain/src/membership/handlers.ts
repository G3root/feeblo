import { Effect, Layer } from "effect";
import { mapToInternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { MembershipRepository } from "./repository";
import { MembershipRpcs } from "./rpcs";

export const MembershipRpcHandlers = MembershipRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* MembershipRepository;

    return {
      MembershipList: () => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.findMany({
            userId: session.session.userId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError()));
      },
    };
  })
).pipe(Layer.provide(MembershipRepository.Default));
