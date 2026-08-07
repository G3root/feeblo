import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { ChangelogCategoryRepository } from "./repository";

type TCanSetChangelogCategories = {
  changelogId: string;
  organizationId: string;
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

  const canDelete = (organizationId: string) =>
    Policy.canPermission(organizationId, "changelog-categories.*");

  const canUpdate = (organizationId: string) =>
    Policy.canPermission(organizationId, "changelog-categories.*");

  /**
   * Category assignments on changelogs are manager-scoped: changelog.* or
   * changelog-categories.*. Contributors can never set changelog categories
   * — changelog creation itself is manager-only, so a contributor can never
   * legitimately be a changelog creator.
   */
  const canSetChangelogCategories = (args: TCanSetChangelogCategories) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.any(
        Policy.canPermission(args.organizationId, "changelog.*"),
        Policy.canPermission(args.organizationId, "changelog-categories.*")
      )
    );

  return { canCreate, canDelete, canUpdate, canSetChangelogCategories };
});

export class ChangelogCategoryPolicy extends Context.Service<ChangelogCategoryPolicy>()(
  "ChangelogCategoryPolicy",
  {
    make: makeChangelogCategoryPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
