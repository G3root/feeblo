import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { PostRepository } from "../post/repository";

type TSource = "dashboard" | "public";

type TCanList = {
  organizationId: string;
  source: TSource;
};

type TCanToggle = {
  organizationId: string;
  postId: string;
  source: TSource;
};

type TCanVoteOnBehalf = {
  organizationId: string;
  postId: string;
};

const makeUpvotePolicy = Effect.gen(function* () {
  const repository = yield* PostRepository;

  const canList = (args: TCanList) => {
    if (args.source === "public") {
      return Policy.policy(() => Effect.succeed(true));
    }

    return Policy.hasMembership(args.organizationId);
  };

  const canToggle = (args: TCanToggle) => {
    if (args.source === "public") {
      return Policy.all(
        Policy.hasRestrictedOrganizationScope(args.organizationId),
        Policy.policy(() =>
          repository.isUnlockedPublic({
            id: args.postId,
            organizationId: args.organizationId,
          })
        )
      );
    }

    return Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.policy(() =>
        repository.isUnlocked({
          id: args.postId,
          organizationId: args.organizationId,
        })
      )
    );
  };

  /**
   * Adding or removing a voter on behalf of a customer is the documented
   * all-role matrix row "Vote for self or on behalf of another user",
   * expressed as the named permission `votes.onBehalf` (contributor and
   * above). Locked posts stay closed to new votes, as with self-service.
   */
  const canVoteOnBehalf = (args: TCanVoteOnBehalf) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.canPermission(args.organizationId, "votes.onBehalf"),
      Policy.policy(() =>
        repository.isUnlocked({
          id: args.postId,
          organizationId: args.organizationId,
        })
      )
    );

  return {
    canList,
    canToggle,
    canVoteOnBehalf,
  };
});

export class UpvotePolicy extends Context.Service<UpvotePolicy>()(
  "UpvotePolicy",
  {
    make: makeUpvotePolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
