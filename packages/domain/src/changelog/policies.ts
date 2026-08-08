import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { ChangelogRepository } from "./repository";

type TCanDelete = {
  organizationId: string;
  changelogId: string;
};

type TCanUpdate = {
  organizationId: string;
  changelogId: string;
};

const makeChangelogPolicy = Effect.gen(function* () {
  const repository = yield* ChangelogRepository;

  const canCreate = (organizationId: string) =>
    Policy.canPermission(organizationId, "changelog.create");

  const canDelete = (args: TCanDelete) =>
    Policy.canPermission(args.organizationId, "changelog.*");

  // The changelog must belong to the caller's organization; changelog ids are
  // enumerable via public listings, so permission alone would let a manager in
  // one organization act on another organization's changelog.
  const canUpdate = (args: TCanUpdate) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "changelog.*"),
      Policy.policy(() =>
        repository.existsInOrganization({
          id: args.changelogId,
          organizationId: args.organizationId,
        })
      )
    );

  return { canCreate, canDelete, canUpdate };
});

export class ChangelogPolicy extends Context.Service<ChangelogPolicy>()(
  "ChangelogPolicy",
  {
    make: makeChangelogPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
