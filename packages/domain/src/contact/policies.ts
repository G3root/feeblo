import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { ContactRepository } from "./repository";
import type { TContactDelete } from "./schema";

const makeContactPolicy = Effect.gen(function* () {
  const repository = yield* ContactRepository;

  const belongsToOrganization = (args: TContactDelete) =>
    Policy.policy(() => repository.exists(args));

  const canCreate = (organizationId: string) =>
    Policy.hasMembership(organizationId);

  const canUpdate = (args: TContactDelete) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      belongsToOrganization(args)
    );

  const canDelete = canUpdate;

  return { belongsToOrganization, canCreate, canUpdate, canDelete };
});

export class ContactPolicy extends Context.Service<ContactPolicy>()(
  "ContactPolicy",
  { make: makeContactPolicy }
) {
  static readonly layer = Layer.effect(this, this.make);
}
