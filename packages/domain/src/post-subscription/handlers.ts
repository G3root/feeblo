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

export const PostSubscriptionRpcHandlers = PostSubscriptionRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* PostSubscriptionRepository;
    const postPolicy = yield* PostPolicy;

    return {
      PostSubscriptionList: (args: TPostSubscriptionList) =>
        repository
          .findSubscribers({
            organizationId: args.organizationId,
            postId: args.postId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("PostSubscription", "select")
          ),
      PostSubscriptionCreate: (args: TPostSubscriptionCreate) =>
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
        }).pipe(
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
      PostSubscriptionDelete: (args: TPostSubscriptionDelete) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          yield* repository.unsubscribe({
            postId: args.postId,
            userId: session.session.userId,
          });

          return { subscribed: false };
        }).pipe(
          Policy.withPolicy(
            postPolicy.isUnlocked({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          ),
          withRemapDbErrors("PostSubscription", "delete")
        ),
    };
  })
).pipe(
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(PostSubscriptionRepository.layer)
);
