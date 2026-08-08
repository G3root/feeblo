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

  //TODO REVISIT LATER
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

  /**
   * companyId is written verbatim by the repository; a caller-supplied id from
   * another organization would create a cross-tenant reference. Succeeds when
   * no company is set or the company belongs to this organization.
   */
  const companyBelongsToOrganization = (args: {
    organizationId: string;
    companyId?: string | null | undefined;
  }) =>
    Policy.policy(() => {
      if (args.companyId == null) {
        return Effect.succeed(true);
      }
      return repository.companyExistsInOrganization({
        id: args.companyId,
        organizationId: args.organizationId,
      });
    });

  const canCreate = (args: TContactCreate) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "contacts.create"),
      userIsOrgMember({
        organizationId: args.organizationId,
        userId: args.userId,
      }),
      companyBelongsToOrganization(args)
    );

  const canUpdate = (args: TContactUpdate) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "contacts.update"),
      belongsToOrganization(args),
      userIsOrgMember({
        organizationId: args.organizationId,
        userId: args.userId,
      }),
      companyBelongsToOrganization(args)
    );

  const canDelete = (args: TContactDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "contacts.*"),
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
