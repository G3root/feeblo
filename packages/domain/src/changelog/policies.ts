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
  yield* ChangelogRepository;

  //TODO CHECK ORGANIZATION OWNED
  const canCreate = (organizationId: string) =>
    Policy.canPermission(organizationId, "changelog.create");

  const canDelete = (args: TCanDelete) =>
    Policy.canPermission(args.organizationId, "changelog.*");

  const canUpdate = (args: TCanUpdate) =>
    Policy.canPermission(args.organizationId, "changelog.*");

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
