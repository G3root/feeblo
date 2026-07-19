import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import { PostRepository } from "./repository";
import { PostIds } from "./schema";

type TSource = "dashboard" | "public";

type TIsCreator = {
  organizationId: string;
  postId: string | readonly string[];
  boardId: string;
};

type TCanCreate = {
  organizationId: string;
  source: TSource;
};

type TCanDelete = {
  organizationId: string;
  postId: string | readonly string[];
  boardId: string;
  source: TSource;
};

type TCanUpdate = {
  organizationId: string;
  postId: string;
  boardId: string;
  source: TSource;
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

  const canCreate = (args: TCanCreate) => {
    if (args.source === "public") {
      return Policy.hasRestrictedOrganizationScope(args.organizationId);
    }
    return Policy.hasMembership(args.organizationId);
  };

  const canDelete = (args: TCanDelete) => {
    if (args.source === "public") {
      return Policy.all(
        Policy.hasRestrictedOrganizationScope(args.organizationId),
        isOwner({
          organizationId: args.organizationId,
          postId: args.postId,
          boardId: args.boardId,
        })
      );
    }
    return Policy.all(
      Policy.hasMembership(args.organizationId),
      isOwner({
        organizationId: args.organizationId,
        postId: args.postId,
        boardId: args.boardId,
      })
    );
  };

  const canUpdate = (args: TCanUpdate) => {
    if (args.source === "public") {
      return Policy.all(
        Policy.hasRestrictedOrganizationScope(args.organizationId),
        isUnlockedPublic({
          organizationId: args.organizationId,
          postId: args.postId,
        }),
        isOwner({
          organizationId: args.organizationId,
          postId: args.postId,
          boardId: args.boardId,
        })
      );
    }
    return Policy.all(
      Policy.hasMembership(args.organizationId),
      isOwner({
        organizationId: args.organizationId,
        postId: args.postId,
        boardId: args.boardId,
      })
    );
  };

  const canAdminUpdate = (organizationId: string) =>
    isOrganizationOwnerOrAdmin(organizationId);

  const canMerge = canAdminUpdate;

  return {
    isCreator,
    isOrganizationOwnerOrAdmin,
    isOwner,
    isUnlocked,
    isUnlockedPublic,
    canCreate,
    canDelete,
    canUpdate,
    canAdminUpdate,
    canMerge,
  };
});

export class PostPolicy extends Context.Service<PostPolicy>()("PostPolicy", {
  make: makePostPolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
