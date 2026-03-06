import { Effect, Option } from "effect";
import * as Policy from "../policy";
import { BoardRepository } from "./repository";

type TIsCreator = {
  organizationId: string;
  boardId: string;
};

export class BoardPolicy extends Effect.Service<BoardPolicy>()("BoardPolicy", {
  effect: Effect.gen(function* () {
    const repository = yield* BoardRepository;

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
        Policy.hasRole("owner"),
        Policy.hasRole("admin"),
        isCreator(args)
      );

    return { isOwner };
  }),
  dependencies: [BoardRepository.Default],
}) {}
