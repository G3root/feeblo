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
  parentCommentId?: string | null;
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

type TCanPin = {
  organizationId: string;
  commentId: string;
  postId: string;
  source: TSource;
};

const makeCommentPolicy = Effect.gen(function* () {
  const repository = yield* CommentRepository;
  const postRepository = yield* PostRepository;

  /**
   * Guards against cross-tenant/cross-post parent references: a reply must
   * point at a comment on the same organization + post. On the public path
   * the parent must additionally be a PUBLIC comment, so anonymous users
   * cannot anchor a reply under an INTERNAL (member-only) comment.
   */
  const canReplyToParent = (args: {
    organizationId: string;
    postId: string;
    parentCommentId?: string | null;
    publicOnly: boolean;
  }) =>
    Policy.policy(() => {
      if (!args.parentCommentId) {
        return Effect.succeed(true);
      }
      return repository
        .findById({
          id: args.parentCommentId,
          organizationId: args.organizationId,
          postId: args.postId,
        })
        .pipe(
          Effect.map((parent) =>
            Option.match(parent, {
              onNone: () => false,
              onSome: (comment) =>
                args.publicOnly ? comment.visibility === "PUBLIC" : true,
            })
          )
        );
    });

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
        ),
        canReplyToParent({ ...args, publicOnly: true })
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
      canReplyToParent({ ...args, publicOnly: false })
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
        Policy.any(
          isOwner({
            organizationId: args.organizationId,
            commentId: args.commentId,
            postId: args.postId,
          }),
          Policy.canPermission(args.organizationId, "comments.*")
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
      ),
      Policy.any(
        isOwner({
          organizationId: args.organizationId,
          commentId: args.commentId,
          postId: args.postId,
        }),
        Policy.canPermission(args.organizationId, "comments.*")
      )
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

  const canPin = (args: TCanPin) => {
    if (args.source === "public") {
      return Policy.all(
        Policy.hasRestrictedOrganizationScope(args.organizationId),
        Policy.policy(() =>
          postRepository.isUnlockedPublic({
            id: args.postId,
            organizationId: args.organizationId,
          })
        ),
        Policy.canPermission(args.organizationId, "comments.*")
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
      Policy.canPermission(args.organizationId, "comments.*")
    );
  };

  return {
    canCreate,
    canDelete,
    canUpdate,
    canPin,
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
