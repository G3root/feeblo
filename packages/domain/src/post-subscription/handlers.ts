import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { PostSubscriptionRepository } from "./repository";
import { PostSubscriptionRpcs } from "./rpcs";
import type {
  TPostSubscriptionCreate,
  TPostSubscriptionDelete,
  TPostSubscriptionList,
} from "./schema";

export const PostSubscriptionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostSubscriptionRepository;
  const postPolicy = yield* PostPolicy;

  // -- Shared effect helpers (no policy applied) --

  const listSubscribersEffect = (args: TPostSubscriptionList) =>
    repository.findSubscribers({
      organizationId: args.organizationId,
      postId: args.postId,
    });

  const subscribeEffect = (args: TPostSubscriptionCreate) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      yield* repository.subscribe({
        organizationId: args.organizationId,
        postId: args.postId,
        userId: session.session.userId,
        ...(membership ? { memberId: membership.membershipId } : {}),
      });

      return { subscribed: true };
    });

  const unsubscribeEffect = (args: TPostSubscriptionDelete) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;

      yield* repository.unsubscribe({
        postId: args.postId,
        userId: session.session.userId,
      });

      return { subscribed: false };
    });

  // -- RPC handlers --

  return {
    PostSubscriptionList: (args: TPostSubscriptionList) =>
      listSubscribersEffect(args).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("PostSubscription", "select")
      ),

    PostSubscriptionListPublic: (args: TPostSubscriptionList) =>
      listSubscribersEffect(args).pipe(
        withRemapDbErrors("PostSubscription", "select")
      ),

    PostSubscriptionCreate: (args: TPostSubscriptionCreate) =>
      subscribeEffect(args).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            postPolicy.isUnlocked({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          )
        ),
        withRemapDbErrors("PostSubscription", "create")
      ),

    PostSubscriptionCreatePublic: (args: TPostSubscriptionCreate) =>
      subscribeEffect(args).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(args.organizationId),
            postPolicy.isUnlockedPublic({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          )
        ),
        withRemapDbErrors("PostSubscription", "create")
      ),

    PostSubscriptionDelete: (args: TPostSubscriptionDelete) =>
      unsubscribeEffect(args).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            postPolicy.isUnlocked({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          )
        ),
        withRemapDbErrors("PostSubscription", "delete")
      ),

    PostSubscriptionDeletePublic: (args: TPostSubscriptionDelete) =>
      unsubscribeEffect(args).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(args.organizationId),
            postPolicy.isUnlockedPublic({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          )
        ),
        withRemapDbErrors("PostSubscription", "delete")
      ),
  };
});

export const PostSubscriptionRpcHandlers = PostSubscriptionRpcs.toLayer(
  PostSubscriptionRpcHandlersEffect
).pipe(
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(PostSubscriptionRepository.layer)
);
