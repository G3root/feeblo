import { Effect, Option } from "effect";
import * as Policy from "../policy";
import { ChangelogRepository } from "./repository";

type TIsCreator = {
  organizationId: string;
  changelogId: string;
};

export class ChangelogPolicy extends Effect.Service<ChangelogPolicy>()(
  "ChangelogPolicy",
  {
    effect: Effect.gen(function* () {
      const repository = yield* ChangelogRepository;

      const isCreator = (args: TIsCreator) =>
        Policy.policy((user) =>
          Option.fromNullable(
            user.memberships.find(
              (membership) => membership.organizationId === args.organizationId
            )
          ).pipe(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (membership) =>
                repository
                  .findByCreatorId({
                    id: args.changelogId,
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

      return { isCreator, isOwner };
    }),
    dependencies: [ChangelogRepository.Default],
  }
) {}
