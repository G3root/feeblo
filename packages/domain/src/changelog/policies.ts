import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { ChangelogRepository } from "./repository";

type TIsCreator = {
  organizationId: string;
  changelogId: string;
};

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

  //TODO CHECK ORGANIZATION OWNED
  const canCreate = (organizationId: string) =>
    Policy.canPermission(organizationId, "changelog.create");

  const canDelete = (args: TCanDelete) =>
    Policy.canPermission(args.organizationId, "changelog.manage");

  const canUpdate = (args: TCanUpdate) =>
    Policy.canPermission(args.organizationId, "changelog.manage");

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
