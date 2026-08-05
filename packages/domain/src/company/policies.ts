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
    Policy.canPermission(organizationId, "companies.create");

  const canUpdate = (args: TCompanyDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "companies.update"),
      belongsToOrganization(args)
    );

  const canDelete = (args: TCompanyDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "companies.manage"),
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
