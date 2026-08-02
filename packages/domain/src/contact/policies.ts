import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { ContactRepository } from "./repository";
import type { TContactCreate, TContactDelete, TContactUpdate } from "./schema";

const makeContactPolicy = Effect.gen(function* () {
  const repository = yield* ContactRepository;

  const belongsToOrganization = (args: TContactDelete) =>
    Policy.policy(() => repository.exists(args));

  const userIsOrgMember = (args: {
    organizationId: string;
    userId: string | null | undefined;
  }) =>
    Policy.policy(() =>
      args.userId == null
        ? Effect.succeed(true)
        : repository.memberExistsByUserId({
            organizationId: args.organizationId,
            userId: args.userId,
          })
    );

  const canCreate = (args: TContactCreate) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      userIsOrgMember({
        organizationId: args.organizationId,
        userId: args.userId,
      })
    );

  const canUpdate = (args: TContactUpdate) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      belongsToOrganization(args),
      userIsOrgMember({
        organizationId: args.organizationId,
        userId: args.userId,
      })
    );

  const canDelete = (args: TContactDelete) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      belongsToOrganization(args)
    );

  return { belongsToOrganization, canCreate, canUpdate, canDelete };
});

export class ContactPolicy extends Context.Service<ContactPolicy>()(
  "ContactPolicy",
  { make: makeContactPolicy }
) {
  static readonly layer = Layer.effect(this, this.make);
}
