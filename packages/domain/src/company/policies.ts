import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { CompanyRepository } from "./repository";
import type { TCompanyDelete } from "./schema";

const makeCompanyPolicy = Effect.gen(function* () {
  const repository = yield* CompanyRepository;

  const belongsToOrganization = (args: TCompanyDelete) =>
    Policy.policy(() => repository.exists(args));

  const canCreate = (organizationId: string) =>
    // The plan's CRM-entry limit is deliberately not checked here: the count
    // is only exact inside the create's transaction, where
    // `CrmEntryGate.ensureCapacity` runs it under the workspace row's lock
    // (a policy runs before the transaction, so two concurrent creates could
    // both see room). Permission stays here as the fast-fail pre-check.
    Policy.canPermission(organizationId, "companies.create");

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
