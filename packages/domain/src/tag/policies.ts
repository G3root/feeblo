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

type TCanSetPostTags = {
  organizationId: string;
  postId: string;
};

const makeTagPolicy = Effect.gen(function* () {
  const repository = yield* TagRepository;

  // `tags.create` is used only by `canCreate`; `canDelete` and `canUpdate`
  // require `tags.*`. Tag assignment via `canSetPostTags` may use `posts.*`,
  // `tags.*`, or the post-creator path, and via `canSetChangelogTags` may use
  // `changelog.*` or `tags.*`; both `canSet*` methods enforce membership
  // directly.
  const canCreate = (organizationId: string) =>
    Policy.canPermission(organizationId, "tags.create");

  const canDelete = (args: TCanDelete) =>
    Policy.canPermission(args.organizationId, "tags.*");

  const canUpdate = (args: TCanUpdate) =>
    Policy.canPermission(args.organizationId, "tags.*");

  const isPostCreator = (args: TCanSetPostTags) =>
    Policy.policy((user) =>
      repository.hasPostCreator({
        postId: args.postId,
        organizationId: args.organizationId,
        userId: user.session.userId,
      })
    );

  /**
   * Post tag assignments are manager-scoped (tags.* / posts.*), but
   * contributors may tag posts they created. Mirrors PostPolicy.canUpdate
   * (posts.* OR creator) with tags.* added, since assignment is also a tag
   * management action.
   */
  const canSetPostTags = (args: TCanSetPostTags) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.any(
        Policy.canPermission(args.organizationId, "posts.*"),
        Policy.canPermission(args.organizationId, "tags.*"),
        isPostCreator(args)
      )
    );

  return {
    canCreate,
    canDelete,
    canUpdate,
    canSetPostTags,
  };
});

export class TagPolicy extends Context.Service<TagPolicy>()("TagPolicy", {
  make: makeTagPolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
