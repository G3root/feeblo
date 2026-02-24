import { Effect, Layer } from "effect";
import { requireOrganizationMembership } from "../authorization";
import { mapToInternalServerError, UnauthorizedError } from "../rpc-errors";
import { BoardNotFoundError, FailedToCreateBoardError } from "./errors";
import { BoardRepository } from "./repository";
import { BoardRpcs } from "./rpcs";
import {
  Board,
  type TBoardCreate,
  type TBoardDelete,
  type TBoardList,
  type TBoardUpdate,
} from "./schema";

export const BoardRpcHandlers = BoardRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* BoardRepository;

    return {
      BoardList: (args: TBoardList) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          return yield* repository.findMany({
            organizationId: args.organizationId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
      BoardDelete: (args: TBoardDelete) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          return yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
      BoardCreate: ({ organizationId, ...rest }: TBoardCreate) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(organizationId);

          const newBoard = yield* repository.create({
            ...rest,
            organizationId,
          });

          if (!newBoard) {
            return yield* FailedToCreateBoardError.make({
              message: "Failed to create board",
            });
          }

          return new Board({
            ...newBoard,
          });
        }).pipe(
          Effect.mapError(
            mapToInternalServerError(
              UnauthorizedError,
              FailedToCreateBoardError
            )
          )
        );
      },
      BoardUpdate: ({ organizationId, ...rest }: TBoardUpdate) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(organizationId);
          const updatedBoard = yield* repository.update({
            ...rest,
            organizationId,
          });

          if (!updatedBoard) {
            return yield* BoardNotFoundError.make({
              message: "Board not found",
            });
          }

          return new Board({
            ...updatedBoard,
          });
        }).pipe(
          Effect.mapError(
            mapToInternalServerError(UnauthorizedError, BoardNotFoundError)
          )
        );
      },
    };
  })
).pipe(Layer.provide(BoardRepository.Default));
