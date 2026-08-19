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

type TCanSetChangelogTags = {
  organizationId: string;
  changelogId: string;
};
const makeTagPolicy = Effect.gen(function* () {
  const repository = yield* TagRepository;

  // Org ownership is enforced via `tags.create` permission check (same gate
  // used for all tag mutations). Membership is asserted by callers via
  // `canSetPostTags`/`canSetChangelogTags`; standalone create/delete/update
  // require `tags.*` which implies privileged membership.
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

  /**
   * Strictly manager-scoped: contributors can never set changelog tags. No
   * creator branch — unlike posts, changelog creation itself is manager-only
   * (changelog.create), so a contributor can never legitimately be a
   * changelog creator, and a demoted creator shouldn't retain tag rights
   * they no longer hold for editing.
   */
  const canSetChangelogTags = (args: TCanSetChangelogTags) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.any(
        Policy.canPermission(args.organizationId, "changelog.*"),
        Policy.canPermission(args.organizationId, "tags.*")
      )
    );

  return {
    canCreate,
    canDelete,
    canUpdate,
    canSetPostTags,
    canSetChangelogTags,
  };
});

export class TagPolicy extends Context.Service<TagPolicy>()("TagPolicy", {
  make: makeTagPolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
