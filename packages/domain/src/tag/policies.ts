import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { TagRepository } from "./repository";

type TIsOwner = {
  organizationId: string;
  tagId: string;
};

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

  const isCreator = (args: TIsOwner) =>
    Policy.policy((user) =>
      repository
        .findById({ id: args.tagId, organizationId: args.organizationId })
        .pipe(
          Effect.map((tag) => {
            if (Option.isSome(tag)) {
              return tag.value.creatorId === user.session.userId;
            }
            return false;
          })
        )
    );

  const isOwner = (args: TIsOwner) =>
    Policy.any(
      Policy.hasOrganizationOwnerOrAdmin(args.organizationId),
      isCreator(args)
    );

  const canCreate = (organizationId: string) =>
    Policy.hasMembership(organizationId);

  const canDelete = (args: TCanDelete) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      isOwner({ organizationId: args.organizationId, tagId: args.tagId })
    );

  const canUpdate = (args: TCanUpdate) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      isOwner({ organizationId: args.organizationId, tagId: args.tagId })
    );

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
