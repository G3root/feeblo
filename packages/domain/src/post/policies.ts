import { isString } from "@feeblo/utils/runtime-kind";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import type { Surface } from "../surface";
import { PostRepository } from "./repository";

type TIsCreator = {
  organizationId: string;
  postId: string | readonly string[];
  boardId: string;
};

/** Post-scoped reference used by policies that only need the id. */
type TPostRef = {
  organizationId: string;
  postId: string;
};

type TCanCreate = {
  organizationId: string;
  /** True when the payload attributes the post to a resolved customer. */
  onBehalf?: boolean;
  source: Surface;
};

type TCanDelete = {
  organizationId: string;
  postId: string | readonly string[];
  boardId: string;
  source: Surface;
};

type TCanUpdate = {
  organizationId: string;
  postId: string;
  boardId: string;
  source: Surface;
};

type TCanUpdateProperties = TCanUpdate & {
  statusId: string;
};

type THasUnchangedLocation = {
  organizationId: string;
  postId: string;
  boardId: string;
  statusId: string;
};

type TIsUnlocked = {
  organizationId: string;
  postId: string;
};

const makePostPolicy = Effect.gen(function* () {
  const repository = yield* PostRepository;

  /**
   * A batch id is the non-string branch of `string | readonly string[]`.
   *
   * `Array.isArray` cannot be used for the false branch: it narrows a
   * `readonly string[]` to `never` on the positive side and leaves it in the
   * union on the negative side, so the single-id branch would still see an
   * array. `isString` splits the union cleanly and follows the repo's
   * runtime-kind convention.
   */
  const isIdBatch = (
    value: string | readonly string[]
  ): value is readonly string[] => !isString(value);

  const isCreator = (args: TIsCreator) =>
    Policy.policy((user) => {
      const { postId } = args;
      // An empty array stays in the batch branch and is denied by the length
      // check below.
      return isIdBatch(postId)
        ? repository
            .findByCreatorIds({
              ids: postId,
              organizationId: args.organizationId,
              userId: user.session.userId,
              boardId: args.boardId,
            })
            // The non-empty check is not redundant with the schema: this
            // predicate also receives ids from internal callers, and
            // `posts.length === 0` for an empty request would read as
            // "owns everything".
            .pipe(
              Effect.map(
                (posts) => postId.length > 0 && posts.length === postId.length
              )
            )
        : repository
            .findByCreatorId({
              id: postId,
              organizationId: args.organizationId,
              userId: user.session.userId,
              boardId: args.boardId,
            })
            .pipe(Effect.map((post) => post._tag === "Some"));
    });

  const isOwner = (args: TIsCreator) =>
    Policy.any(
      Policy.canPermission(args.organizationId, "posts.*"),
      isCreator(args)
    );

  const isNewPostOwner = (args: TIsCreator) =>
    Policy.policy((user) => {
      const { postId } = args;
      return isIdBatch(postId)
        ? repository
            .findNewByCreatorIds({
              ids: postId,
              organizationId: args.organizationId,
              userId: user.session.userId,
              boardId: args.boardId,
            })
            .pipe(
              Effect.map(
                (posts) => postId.length > 0 && posts.length === postId.length
              )
            )
        : repository
            .findNewByCreatorId({
              id: postId,
              organizationId: args.organizationId,
              userId: user.session.userId,
              boardId: args.boardId,
            })
            .pipe(Effect.map((post) => post._tag === "Some"));
    });

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

  /**
   * Guards the read-only merged state: a post merged into another is hidden
   * from lists and disabled for every mutation until it is unmerged. Bulk
   * callers pass every id; a single merged id denies the whole operation.
   */
  const isNotMerged = (args: {
    organizationId: string;
    postId: string | readonly string[];
  }) =>
    Policy.policy(() =>
      repository
        .findMergedIds({
          ids: isIdBatch(args.postId) ? args.postId : [args.postId],
          organizationId: args.organizationId,
        })
        .pipe(Effect.map((posts) => posts.length === 0))
    );

  const isUnlockedPublic = (args: TIsUnlocked) =>
    Policy.policy(() =>
      repository.isUnlockedPublic({
        id: args.postId,
        organizationId: args.organizationId,
      })
    );

  /**
   * Requires the submitted board/status to equal the post's current location.
   * Public-portal updates are rename semantics only: status and board changes
   * are moderator actions reserved for `posts.status`/`posts.move` holders via
   * the dashboard RPCs, so the public variant must never relocate a post.
   */
  const hasUnchangedLocation = (args: THasUnchangedLocation) =>
    Policy.policy(() =>
      repository
        .findLocationIds({
          id: args.postId,
          organizationId: args.organizationId,
        })
        .pipe(
          Effect.map(
            (location) =>
              location != null &&
              location.boardId === args.boardId &&
              location.statusId === args.statusId
          )
        )
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
        isNotMerged({
          organizationId: args.organizationId,
          postId: args.postId,
        }),
        isNewPostOwnerOrPrivileged({
          organizationId: args.organizationId,
          postId: args.postId,
          boardId: args.boardId,
        })
      );
    }
    return Policy.all(
      Policy.hasMembership(args.organizationId),
      isNotMerged({
        organizationId: args.organizationId,
        postId: args.postId,
      }),
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
      isNotMerged({
        organizationId: args.organizationId,
        postId: args.postId,
      }),
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
      isNotMerged({
        organizationId: args.organizationId,
        postId: args.postId,
      }),
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

  /**
   * Re-attributing a post to another customer reuses the on-behalf creation
   * capability (`posts.createOnBehalf`, managers and above): the same
   * attribution boundary applies whether the customer is named at creation
   * or reassigned later.
   */
  const canUpdateAuthor = (args: TPostRef) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      isNotMerged(args),
      Policy.canPermission(args.organizationId, "posts.createOnBehalf")
    );

  /** ETA is a post property reserved for managers and above (`posts.status`). */
  const canUpdateEta = (args: TPostRef) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      isNotMerged(args),
      Policy.canPermission(args.organizationId, "posts.status")
    );

  const canAdminUpdate = (args: TPostRef) =>
    Policy.all(
      isNotMerged(args),
      Policy.canPermission(args.organizationId, "posts.*")
    );

  const canMerge = (organizationId: string) =>
    Policy.canPermission(organizationId, "posts.*");

  return {
    isUnlocked,
    isUnlockedPublic,
    hasUnchangedLocation,
    canCreate,
    canDelete,
    canUpdate,
    canUpdateProperties,
    canUpdateAuthor,
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
