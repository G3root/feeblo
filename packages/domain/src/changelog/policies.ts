import { Context, Effect, Layer, Option } from "effect";
import * as Policy from "../policy";
import { ChangelogRepository } from "./repository";

type TIsCreator = {
  organizationId: string;
  changelogId: string;
};

const makeChangelogPolicy = Effect.gen(function* () {
  const repository = yield* ChangelogRepository;

  const isCreator = (args: TIsCreator) =>
    Policy.policy((user) =>
      Option.fromNullishOr(
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
      Policy.hasOrganizationRole(args.organizationId, "owner"),
      Policy.hasOrganizationRole(args.organizationId, "admin"),
      isCreator(args)
    );

  return { isCreator, isOwner };
});

export class ChangelogPolicy extends Context.Service<ChangelogPolicy>()(
  "ChangelogPolicy",
  {
    make: makeChangelogPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
