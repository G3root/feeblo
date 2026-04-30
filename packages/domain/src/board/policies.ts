import { Effect, Option } from "effect";
import * as Policy from "../policy";
import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import { WorkspaceRepository } from "../workspace/repository";
import { BoardRepository } from "./repository";

type TIsCreator = {
  organizationId: string;
  boardId: string;
};

type TCanCreate = {
  organizationId: string;
  visibility: "PUBLIC" | "PRIVATE";
};

type TCanUpdate = {
  organizationId: string;
  boardId: string;
  visibility: "PUBLIC" | "PRIVATE";
};

const makeBoardPolicy = Effect.gen(function* () {
  const repository = yield* BoardRepository;
  const workspaceRepository = yield* WorkspaceRepository;

  const isCreator = (args: TIsCreator) =>
    Policy.policy((user) =>
      Option.fromNullable(
        user.memberships.find((m) => m.organizationId === args.organizationId)
      ).pipe(
        Option.match({
          onNone: () => Effect.succeed(false),
          onSome: (membership) =>
            repository
              .findById({
                id: args.boardId,
                organizationId: args.organizationId,
                memberId: membership.membershipId,
              })
              .pipe(Effect.map(Option.isSome)),
        })
      )
    );

  const isOwner = (args: TIsCreator) =>
    Policy.any(
      Policy.hasOrganizationRole(args.organizationId, "owner"),
      Policy.hasOrganizationRole(args.organizationId, "admin"),
      isCreator(args)
    );

  const canCreate = (args: TCanCreate) =>
    Effect.gen(function* () {
      const planState = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId: args.organizationId,
      });
      const entitlements = PLAN_ENTITLEMENTS[planState.plan];

      if (args.visibility === "PRIVATE" && !entitlements.privateBoards) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Private boards require the Starter plan or higher.",
        });
      }

      if (entitlements.boardLimit !== null) {
        const boardCount = yield* repository.countByOrganizationId({
          organizationId: args.organizationId,
        });

        if (boardCount >= entitlements.boardLimit) {
          return yield* new Policy.PolicyDeniedError({
            reason: `The ${planState.plan} plan allows up to ${entitlements.boardLimit} feedback boards.`,
          });
        }
      }
    });

  const canUpdate = (args: TCanUpdate) =>
    Effect.gen(function* () {
      if (args.visibility !== "PRIVATE") {
        return;
      }

      const board = yield* repository.getById({
        id: args.boardId,
        organizationId: args.organizationId,
      });

      if (Option.isSome(board) && board.value.visibility === "PRIVATE") {
        return;
      }

      const planState = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId: args.organizationId,
      });

      if (!PLAN_ENTITLEMENTS[planState.plan].privateBoards) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Private boards require the Starter plan or higher.",
        });
      }
    });

  return { isOwner, canCreate, canUpdate };
});

export class BoardPolicy extends Effect.Service<BoardPolicy>()("BoardPolicy", {
  effect: makeBoardPolicy,
  dependencies: [BoardRepository.Default, WorkspaceRepository.Default],
}) {
  static readonly layer = this.Default;
}
