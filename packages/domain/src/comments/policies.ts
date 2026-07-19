import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { PostRepository } from "../post/repository";
import { CommentRepository } from "./repository";

type TSource = "dashboard" | "public";

type TIsOwner = {
  organizationId: string;
  commentId: string;
  postId: string;
};

type TCanCreate = {
  organizationId: string;
  visibility: "PUBLIC" | "INTERNAL";
  postId: string;
  source: TSource;
};

type TCanDelete = {
  organizationId: string;
  commentId: string;
  postId: string;
  source: TSource;
};

type TCanUpdate = {
  organizationId: string;
  commentId: string;
  postId: string;
  source: TSource;
};

const makeCommentPolicy = Effect.gen(function* () {
  const repository = yield* CommentRepository;
  const postRepository = yield* PostRepository;

  const canCreate = (args: TCanCreate) => {
    if (args.source === "public") {
      return Policy.all(
        Policy.hasRestrictedOrganizationScope(args.organizationId),
        Policy.policy(() =>
          postRepository.isUnlockedPublic({
            id: args.postId,
            organizationId: args.organizationId,
          })
        ),
        Policy.any(
          // member can create internal and public comments
          Policy.hasMembership(args.organizationId),
          Policy.policy(() => Effect.succeed(args.visibility === "PUBLIC"))
        )
      );
    }

    return Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.policy(() =>
        postRepository.isUnlocked({
          id: args.postId,
          organizationId: args.organizationId,
        })
      )
    );
  };

  const isOwner = (args: TIsOwner) =>
    Policy.policy((user) =>
      repository
        .findById({
          id: args.commentId,
          organizationId: args.organizationId,
          postId: args.postId,
          userId: user.session.userId,
        })
        .pipe(Effect.map(Option.isSome))
    );

  const canDelete = (args: TCanDelete) => {
    if (args.source === "public") {
      return Policy.all(
        Policy.hasRestrictedOrganizationScope(args.organizationId),
        Policy.policy(() =>
          postRepository.isUnlockedPublic({
            id: args.postId,
            organizationId: args.organizationId,
          })
        ),
        isOwner({
          organizationId: args.organizationId,
          commentId: args.commentId,
          postId: args.postId,
        })
      );
    }

    return Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.policy(() =>
        postRepository.isUnlocked({
          id: args.postId,
          organizationId: args.organizationId,
        })
      ),
      isOwner({
        organizationId: args.organizationId,
        commentId: args.commentId,
        postId: args.postId,
      })
    );
  };

  const canUpdate = (args: TCanUpdate) => {
    if (args.source === "public") {
      return Policy.all(
        Policy.hasRestrictedOrganizationScope(args.organizationId),
        Policy.policy(() =>
          postRepository.isUnlockedPublic({
            id: args.postId,
            organizationId: args.organizationId,
          })
        ),
        isOwner({
          organizationId: args.organizationId,
          commentId: args.commentId,
          postId: args.postId,
        })
      );
    }

    return Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.policy(() =>
        postRepository.isUnlocked({
          id: args.postId,
          organizationId: args.organizationId,
        })
      ),
      isOwner({
        organizationId: args.organizationId,
        commentId: args.commentId,
        postId: args.postId,
      })
    );
  };

  return {
    canCreate,
    canDelete,
    canUpdate,
  };
});

export class CommentPolicy extends Context.Service<CommentPolicy>()(
  "CommentPolicy",
  {
    make: makeCommentPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
