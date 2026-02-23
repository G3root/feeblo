import { Effect, Layer } from "effect";
import { CurrentSession } from "../session-middleware";
import { BoardRepository } from "./repository";
import { BoardRpcs } from "./rpcs";
import type { TBoardCreate, TBoardUpdate } from "./schema";

export const BoardRpcHandlers = BoardRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* BoardRepository;

    return {
      BoardList: () => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.findMany({
            organizationId: session.session.activeOrganizationId,
          });
        }).pipe(Effect.orDie);
      },
      BoardDelete: ({ id }: { id: string }) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.delete({
            id,
            organizationId: session.session.activeOrganizationId,
          });
        }).pipe(Effect.orDie);
      },
      BoardCreate: (args: TBoardCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.create({
            ...args,
            organizationId: session.session.activeOrganizationId,
          });
        }).pipe(Effect.orDie);
      },
      BoardUpdate: (args: TBoardUpdate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.update({
            ...args,
            organizationId: session.session.activeOrganizationId,
          });
        }).pipe(Effect.orDie);
      },
    };
  })
).pipe(Layer.provide(BoardRepository.Default));
