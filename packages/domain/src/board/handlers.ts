import { Effect, Layer } from "effect";
import { requireOrganizationMembership } from "../authorization";
import * as Policy from "../policy";
import { onInternalServerError, UnauthorizedError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { BoardPolicy } from "./policies";
import { BoardRepository } from "./repository";
import { BoardRpcs } from "./rpcs";
import type {
  TBoardCreate,
  TBoardDelete,
  TBoardList,
  TBoardUpdate,
} from "./schema";

export const BoardRpcHandlers = BoardRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* BoardRepository;
    const boardPolicy = yield* BoardPolicy;
    return {
      BoardList: (args: TBoardList) => {
        return Effect.gen(function* () {
          return yield* repository.findMany({
            organizationId: args.organizationId,
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchAll(onInternalServerError)
        );
      },
      BoardListPublic: (args: TBoardList) => {
        return Effect.gen(function* () {
          return yield* repository.findMany({
            organizationId: args.organizationId,
            visibility: "PUBLIC",
          });
        }).pipe(Effect.catchAll(onInternalServerError));
      },
      BoardDelete: (args: TBoardDelete) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          return yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
          });
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              boardPolicy.isOwner({
                organizationId: args.organizationId,
                boardId: args.id,
              })
            )
          ),
          Effect.catchAll(onInternalServerError)
        );
      },
      BoardCreate: (args: TBoardCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const isMember = session.memberships.find(
            (membership) => membership.organizationId === args.organizationId
          );

          if (!isMember) {
            return yield* Effect.fail(
              new UnauthorizedError({
                message: "You are not a member of this organization",
              })
            );
          }
          yield* repository.create({
            ...args,
            creatorId: session.session.userId,
            creatorMemberId: isMember.membershipId,
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchAll(onInternalServerError)
        );
      },
      BoardUpdate: (args: TBoardUpdate) => {
        return Effect.gen(function* () {
          return yield* repository.update(args);
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              boardPolicy.isOwner({
                organizationId: args.organizationId,
                boardId: args.id,
              })
            )
          ),
          Effect.catchAll(onInternalServerError)
        );
      },
    };
  })
).pipe(
  Layer.provide(BoardRepository.Default),
  Layer.provide(BoardPolicy.Default)
);
