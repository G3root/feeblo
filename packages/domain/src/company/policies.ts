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
    Policy.hasMembership(organizationId);

  const canUpdate = (args: TCompanyDelete) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      belongsToOrganization(args)
    );

  const canDelete = canUpdate;

  return { belongsToOrganization, canCreate, canUpdate, canDelete };
});

export class CompanyPolicy extends Context.Service<CompanyPolicy>()(
  "CompanyPolicy",
  { make: makeCompanyPolicy }
) {
  static readonly layer = Layer.effect(this, this.make);
}
