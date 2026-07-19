import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { BoardRepository } from "./repository";

type TIsCreator = {
  organizationId: string;
  boardId: string;
};

type TCanCreate = {
  organizationId: string;
  visibility: "PUBLIC" | "PRIVATE";
};

type TCanDelete = {
  organizationId: string;
  boardId: string;
};

type TCanUpdate = {
  organizationId: string;
  boardId: string;
  visibility: "PUBLIC" | "PRIVATE";
};

const makeBoardPolicy = Effect.gen(function* () {
  const repository = yield* BoardRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  const isCreator = (args: TIsCreator) =>
    Policy.policy((user) =>
      Option.fromNullishOr(
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
    Policy.all(
      Policy.hasMembership(args.organizationId),
      entitlementPolicy.canCreateBoard({
        ...args,
        boardCount: repository.countByOrganizationId({
          organizationId: args.organizationId,
        }),
      })
    );

  const canDelete = (args: TCanDelete) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      isOwner({ organizationId: args.organizationId, boardId: args.boardId })
    );

  const canUpdate = (args: TCanUpdate) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      isOwner({ organizationId: args.organizationId, boardId: args.boardId }),
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

        yield* entitlementPolicy.canUpdateBoardVisibility({
          organizationId: args.organizationId,
        });
      })
    );

  return { canCreate, canDelete, canUpdate };
});

export class BoardPolicy extends Context.Service<BoardPolicy>()("BoardPolicy", {
  make: makeBoardPolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
