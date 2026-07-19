import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { ChangelogRepository } from "./repository";

type TIsCreator = {
  organizationId: string;
  changelogId: string;
};

type TCanDelete = {
  organizationId: string;
  changelogId: string;
};

type TCanUpdate = {
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

  const canCreate = (organizationId: string) =>
    Policy.hasMembership(organizationId);

  const canDelete = (args: TCanDelete) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      isOwner({
        organizationId: args.organizationId,
        changelogId: args.changelogId,
      })
    );

  const canUpdate = (args: TCanUpdate) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      isOwner({
        organizationId: args.organizationId,
        changelogId: args.changelogId,
      })
    );

  return { isCreator, isOwner, canCreate, canDelete, canUpdate };
});

export class ChangelogPolicy extends Context.Service<ChangelogPolicy>()(
  "ChangelogPolicy",
  {
    make: makeChangelogPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
