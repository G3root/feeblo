import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CompanyRepository } from "../company/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { ContactRepository } from "./repository";
import type { TContactCreate, TContactDelete, TContactUpdate } from "./schema";

const makeContactPolicy = Effect.gen(function* () {
  const repository = yield* ContactRepository;
  const companyRepository = yield* CompanyRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  const belongsToOrganization = (args: TContactDelete) =>
    Policy.policy(() => repository.exists(args));

  // Linked user must already be a member of the organization; null (no
  // linked user) is allowed for external contacts created before SSO.
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
      companyBelongsToOrganization(args),
      entitlementPolicy.canCreateCrmEntry({
        organizationId: args.organizationId,
        crmEntryCount: Effect.gen(function* () {
          const contactCount = yield* repository.countByOrganizationId(
            args.organizationId
          );
          const companyCount = yield* companyRepository.countByOrganizationId(
            args.organizationId
          );
          return contactCount + companyCount;
        }),
      })
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
