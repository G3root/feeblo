import { Context, Effect, Layer, Option } from "effect";
import * as Policy from "../policy";
import { TagRepository } from "./repository";

type TIsOwner = {
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

  const isOrganizationOwnerOrAdmin = (organizationId: string) =>
    Policy.any(
      Policy.hasOrganizationRole(organizationId, "admin"),
      Policy.hasOrganizationRole(organizationId, "owner")
    );

  const isOwner = (args: TIsOwner) =>
    Policy.any(
      isOrganizationOwnerOrAdmin(args.organizationId),
      isCreator(args)
    );

  return {
    isCreator,
    isOrganizationOwnerOrAdmin,
    isOwner,
  };
});

export class TagPolicy extends Context.Service<TagPolicy>()("TagPolicy", {
  make: makeTagPolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
