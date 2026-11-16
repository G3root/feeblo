import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
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

export const BoardRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* BoardRepository;
  const boardPolicy = yield* BoardPolicy;

  // const sitePolicy = yield* SitePolicy;
  return {
    ListBoards: (args: TBoardList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Board", "select")
        ),
    ListBoardsPublic: (args: TBoardList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
          visibility: "PUBLIC",
        })
        .pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "ListBoardsPublic",
            level: "read",
          }),
          withRemapDbErrors("Board", "select")
        ),
    DeleteBoard: (args: TBoardDelete) => {
      return Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.delete({
              id: args.id,
              organizationId: args.organizationId,
            });
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "board.deleted",
              resourceId: args.id,
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          boardPolicy.canDelete({
            organizationId: args.organizationId,
            boardId: args.id,
          })
        ),
        withRemapDbErrors("Board", "delete")
      );
    },
    CreateBoard: (args: TBoardCreate) => {
      return Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        const isMember = session.memberships.find(
          (membership) => membership.organizationId === args.organizationId
        );

        if (!isMember) {
          return yield* new Policy.PolicyDeniedError({
            reason: "You are not a member of this organization",
          });
        }

        yield* transaction(
          Effect.gen(function* () {
            yield* repository.create({
              ...args,
              creatorId: session.session.userId,
              creatorMemberId: isMember.membershipId,
            });
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "board.created",
              resourceId: args.id,
              metadata: { name: args.name, visibility: args.visibility },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          boardPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
          })
        ),
        withRemapDbErrors("Board", "create")
      );
    },
    UpdateBoard: (args: TBoardUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            // Locked, and inside the transaction: the diff has to name the
            // value this update replaced, not the one a concurrent save was
            // about to replace. The full row, not `getById`, because the diff
            // needs the previous name; both reads are workspace-scoped.
            const currentBoard =
              yield* repository.findByIdInOrganizationForUpdate({
                id: args.id,
                organizationId: args.organizationId,
              });

            if (Option.isNone(currentBoard)) {
              return yield* new BadRequestError({
                message: "Board not found",
              });
            }

            const previous = currentBoard.value;

            // A save that changed nothing is not an event; `fields` is what
            // the reader filters on, so an empty diff is left unrecorded
            // rather than written as an update with no change.
            const fields = [
              ...(previous.name === args.name ? [] : ["name"]),
              ...(previous.visibility === args.visibility
                ? []
                : ["visibility"]),
            ];

            yield* repository.update(args);

            if (fields.length === 0) {
              return;
            }

            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "board.updated",
              resourceId: args.id,
              changes: {
                fields,
                before: {
                  name: previous.name,
                  visibility: previous.visibility,
                },
                after: { name: args.name, visibility: args.visibility },
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          boardPolicy.canUpdate({
            organizationId: args.organizationId,
            boardId: args.id,
            visibility: args.visibility,
          })
        ),
        withRemapDbErrors("Board", "update")
      ),
  };
});

export const BoardRpcHandlers = BoardRpcs.toLayer(BoardRpcHandlersEffect).pipe(
  Layer.provide(BoardPolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(BoardRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
