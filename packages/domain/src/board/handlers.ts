import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
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
    // const sitePolicy = yield* SitePolicy;
    return {
      BoardList: (args: TBoardList) =>
        repository
          .findMany({
            organizationId: args.organizationId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Board", "select")
          ),
      BoardListPublic: (args: TBoardList) =>
        repository
          .findMany({
            organizationId: args.organizationId,
            visibility: "PUBLIC",
          })
          .pipe(withRemapDbErrors("Board", "select")),
      BoardDelete: (args: TBoardDelete) => {
        return repository
          .delete({
            id: args.id,
            organizationId: args.organizationId,
          })
          .pipe(
            Policy.withPolicy(
              Policy.all(
                Policy.hasMembership(args.organizationId),
                boardPolicy.isOwner({
                  organizationId: args.organizationId,
                  boardId: args.id,
                })
              )
            ),
            withRemapDbErrors("Board", "delete")
          );
      },
      BoardCreate: (args: TBoardCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const isMember = session.memberships.find(
            (membership) => membership.organizationId === args.organizationId
          );

          if (!isMember) {
            return yield* new Policy.PolicyDeniedError({
              reason: "You are not a member of this organization",
            });
          }

          yield* repository.create({
            ...args,
            creatorId: session.session.userId,
            creatorMemberId: isMember.membershipId,
          });
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              boardPolicy.canCreate({
                organizationId: args.organizationId,
                visibility: args.visibility,
              })
            )
          ),
          withRemapDbErrors("Board", "create")
        );
      },
      BoardUpdate: (args: TBoardUpdate) =>
        Effect.gen(function* () {
          const currentBoard = yield* repository.getById({
            id: args.id,
            organizationId: args.organizationId,
          });

          if (Option.isNone(currentBoard)) {
            return yield* new BadRequestError({
              message: "Board not found",
            });
          }

          yield* repository.update(args);
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              boardPolicy.isOwner({
                organizationId: args.organizationId,
                boardId: args.id,
              }),
              boardPolicy.canUpdate({
                organizationId: args.organizationId,
                boardId: args.id,
                visibility: args.visibility,
              })
            )
          ),
          withRemapDbErrors("Board", "update")
        ),
    };
  })
).pipe(
  Layer.provide(BoardPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(BoardRepository.layer)
);
