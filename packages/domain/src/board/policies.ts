import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { BoardRepository } from "./repository";

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

  const canCreate = (args: TCanCreate) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "boards.create"),
      entitlementPolicy.canCreateBoard({
        ...args,
        boardCount: repository.countByOrganizationId({
          organizationId: args.organizationId,
        }),
      })
    );

  const canDelete = (args: TCanDelete) =>
    Policy.canPermission(args.organizationId, "boards.delete");

  const canUpdate = (args: TCanUpdate) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "boards.update"),
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
