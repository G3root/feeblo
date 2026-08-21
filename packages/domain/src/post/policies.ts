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
  /** True when the payload attributes the post to a resolved customer. */
  onBehalf?: boolean;
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

type TCanUpdateProperties = TCanUpdate & {
  statusId: string;
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

  const isOwner = (args: TIsCreator) =>
    Policy.any(
      Policy.canPermission(args.organizationId, "posts.*"),
      isCreator(args)
    );

  const isNewPostOwner = (args: TIsCreator) =>
    Policy.policy((user) =>
      pipe(args.postId, (postId) =>
        Schema.is(PostIds)(postId)
          ? repository
              .findNewByCreatorIds({
                ids: postId,
                organizationId: args.organizationId,
                userId: user.session.userId,
                boardId: args.boardId,
              })
              .pipe(Effect.map((posts) => posts.length === postId.length))
          : repository
              .findNewByCreatorId({
                id: postId,
                organizationId: args.organizationId,
                userId: user.session.userId,
                boardId: args.boardId,
              })
              .pipe(Effect.map((post) => post._tag === "Some"))
      )
    );

  const isNewPostOwnerOrPrivileged = (args: TIsCreator) =>
    Policy.any(
      Policy.canPermission(args.organizationId, "posts.*"),
      isNewPostOwner(args)
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
    if (args.onBehalf === true) {
      // Attributing a post to a customer is a curation capability reserved
      // for managers and above (`posts.createOnBehalf`).
      return Policy.all(
        Policy.hasMembership(args.organizationId),
        Policy.canPermission(args.organizationId, "posts.createOnBehalf")
      );
    }
    return Policy.hasMembership(args.organizationId);
  };

  const canDelete = (args: TCanDelete) => {
    if (args.source === "public") {
      return Policy.all(
        Policy.hasRestrictedOrganizationScope(args.organizationId),
        isNewPostOwnerOrPrivileged({
          organizationId: args.organizationId,
          postId: args.postId,
          boardId: args.boardId,
        })
      );
    }
    return Policy.all(
      Policy.hasMembership(args.organizationId),
      isNewPostOwnerOrPrivileged({
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

  const canUpdateProperties = (args: TCanUpdateProperties) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.any(
        Policy.canPermission(args.organizationId, "posts.status"),
        Policy.all(
          Policy.canPermission(args.organizationId, "posts.move"),
          Policy.policy(() =>
            repository
              .findStatusId({
                id: args.postId,
                organizationId: args.organizationId,
              })
              .pipe(
                Effect.map(
                  (currentStatusId) => currentStatusId === args.statusId
                )
              )
          )
        )
      )
    );

  /** ETA is a post property reserved for managers and above (`posts.status`). */
  const canUpdateEta = (organizationId: string) =>
    Policy.all(
      Policy.hasMembership(organizationId),
      Policy.canPermission(organizationId, "posts.status")
    );

  const canAdminUpdate = (organizationId: string) =>
    Policy.canPermission(organizationId, "posts.*");

  const canMerge = canAdminUpdate;

  return {
    isUnlocked,
    isUnlockedPublic,
    canCreate,
    canDelete,
    canUpdate,
    canUpdateProperties,
    canUpdateEta,
    canAdminUpdate,
    canMerge,
  };
});

export class PostPolicy extends Context.Service<PostPolicy>()("PostPolicy", {
  make: makePostPolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
