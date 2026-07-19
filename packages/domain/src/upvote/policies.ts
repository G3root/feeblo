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

  return {
    canList,
    canToggle,
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
