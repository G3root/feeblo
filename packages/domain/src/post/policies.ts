import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import { PostRepository } from "./repository";
import { PostIds } from "./schema";

type TIsCreator = {
  organizationId: string;
  postId: string | readonly string[];
  boardId: string;
};

type TIsUnlocked = {
  organizationId: string;
  postId: string;
};

const makePostPolicy = Effect.gen(function* () {
  const repository = yield* PostRepository;

  const isCreator = (args: TIsCreator) =>
    Policy.policy((user) =>
      pipe(args.postId, (postId) =>
        Schema.is(PostIds)(postId)
          ? repository
              .findByCreatorIds({
                ids: postId,
                organizationId: args.organizationId,
                userId: user.session.userId,
                boardId: args.boardId,
              })
              .pipe(Effect.map((posts) => posts.length === postId.length))
          : repository
              .findByCreatorId({
                id: postId,
                organizationId: args.organizationId,
                userId: user.session.userId,
                boardId: args.boardId,
              })
              .pipe(Effect.map((post) => post._tag === "Some"))
      )
    );

  const isOrganizationOwnerOrAdmin = (organizationId: string) =>
    Policy.policy((user) =>
      Effect.succeed(
        user.memberships.some(
          (membership) =>
            membership.organizationId === organizationId &&
            (membership.role === "owner" || membership.role === "admin")
        )
      )
    );

  const isOwner = (args: TIsCreator) =>
    Policy.any(
      isOrganizationOwnerOrAdmin(args.organizationId),
      isCreator(args)
    );

  const isUnlocked = (args: TIsUnlocked) =>
    Policy.policy(() =>
      repository.isUnlocked({
        id: args.postId,
        organizationId: args.organizationId,
      })
    );

  const isUnlockedPublic = (args: TIsUnlocked) =>
    Policy.policy(() =>
      repository.isUnlockedPublic({
        id: args.postId,
        organizationId: args.organizationId,
      })
    );

  return {
    isCreator,
    isOrganizationOwnerOrAdmin,
    isOwner,
    isUnlocked,
    isUnlockedPublic,
  };
});

export class PostPolicy extends Context.Service<PostPolicy>()("PostPolicy", {
  make: makePostPolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
