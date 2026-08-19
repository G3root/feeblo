import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ContactRepository } from "../contact/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { CompanyRepository } from "./repository";
import type { TCompanyDelete } from "./schema";

const makeCompanyPolicy = Effect.gen(function* () {
  const repository = yield* CompanyRepository;
  const contactRepository = yield* ContactRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  const belongsToOrganization = (args: TCompanyDelete) =>
    Policy.policy(() => repository.exists(args));

  const canCreate = (organizationId: string) =>
    Policy.all(
      Policy.canPermission(organizationId, "companies.create"),
      entitlementPolicy.canCreateCrmEntry({
        organizationId,
        crmEntryCount: Effect.gen(function* () {
          const companyCount = yield* repository.countByOrganizationId(organizationId);
          const contactCount = yield* contactRepository.countByOrganizationId(organizationId);
          return companyCount + contactCount;
        }),
      })
    );

  const canUpdate = (args: TCompanyDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "companies.update"),
      belongsToOrganization(args)
    );

  const canDelete = (args: TCompanyDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "companies.*"),
      belongsToOrganization(args)
    );

  return { belongsToOrganization, canCreate, canUpdate, canDelete };
});

export class CompanyPolicy extends Context.Service<CompanyPolicy>()(
  "CompanyPolicy",
  { make: makeCompanyPolicy }
) {
  static readonly layer = Layer.effect(this, this.make);
}
