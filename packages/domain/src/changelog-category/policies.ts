import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { ChangelogCategoryRepository } from "./repository";

type TCanDelete = {
  organizationId: string;
  categoryId: string;
};

type TCanUpdate = {
  organizationId: string;
  categoryId: string;
};

const makeChangelogCategoryPolicy = Effect.gen(function* () {
  const repository = yield* ChangelogCategoryRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  const canCreate = (organizationId: string) =>
    Policy.all(
      Policy.canPermission(organizationId, "changelog-categories.create"),
      entitlementPolicy.canCreateChangelogCategory({
        organizationId,
        categoryCount: repository.countByOrganizationId({ organizationId }),
      })
    );

  const canDelete = (args: TCanDelete) =>
    Policy.canPermission(args.organizationId, "changelog-categories.*");

  const canUpdate = (args: TCanUpdate) =>
    Policy.canPermission(args.organizationId, "changelog-categories.*");

  return { canCreate, canDelete, canUpdate };
});

export class ChangelogCategoryPolicy extends Context.Service<ChangelogCategoryPolicy>()(
  "ChangelogCategoryPolicy",
  {
    make: makeChangelogCategoryPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
