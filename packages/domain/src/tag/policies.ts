import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { TagRepository } from "./repository";

type TCanDelete = {
  organizationId: string;
  tagId: string;
};

type TCanUpdate = {
  organizationId: string;
  tagId: string;
};

const makeTagPolicy = Effect.gen(function* () {
  const repository = yield* TagRepository;

  // TODO ADD ORG OWNERSHIP CHECK
  const canCreate = (organizationId: string) =>
    Policy.canPermission(organizationId, "tags.create");

  const canDelete = (args: TCanDelete) =>
    Policy.canPermission(args.organizationId, "tags.manage");

  const canUpdate = (args: TCanUpdate) =>
    Policy.canPermission(args.organizationId, "tags.manage");

  return {
    canCreate,
    canDelete,
    canUpdate,
  };
});

export class TagPolicy extends Context.Service<TagPolicy>()("TagPolicy", {
  make: makeTagPolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
