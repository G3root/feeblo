import { transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import * as RateLimit from "../rate-limit";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
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
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const postPolicy = yield* PostPolicy;

  // -- Shared effect helpers (no policy applied) --

  const listSubscribersEffect = (
    args: TPostSubscriptionList,
    options?: { publicOnly?: boolean; userId?: string }
  ) =>
    repository.findSubscribers({
      organizationId: args.organizationId,
      postId: args.postId,
      ...(options?.publicOnly !== undefined && { publicOnly: options.publicOnly }),
      ...(options?.userId !== undefined && { userId: options.userId }),
    });

  const subscribeEffect = (args: TPostSubscriptionCreate) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      const now = yield* DateTime.nowAsDate;
      yield* transaction(
        Effect.gen(function* () {
          yield* repository.subscribe({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
            ...(membership && { memberId: membership.membershipId }),
          });
          yield* emailSubscriptions
            .requestSubscription({
              alreadyVerifiedUser: { userId: session.session.userId },
              email: session.user.email,
              now,
              organizationId: args.organizationId,
              source: "explicit",
              topic: { topicId: args.postId, topicType: "post" },
              verificationExpiresAt: new Date(now.getTime() + 86_400_000),
            })
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({
                    message: "Could not record the post email subscription.",
                  })
              )
            );
        })
      );

      return { subscribed: true };
    });

  const unsubscribeEffect = (args: TPostSubscriptionDelete) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;

      yield* transaction(
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          yield* repository.unsubscribe({
            postId: args.postId,
            userId: session.session.userId,
          });
          yield* emailSubscriptions
            .unsubscribeAuthenticatedSubscription({
              now,
              organizationId: args.organizationId,
              topic: { topicId: args.postId, topicType: "post" },
              userId: session.session.userId,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({
                    message:
                      "Could not unsubscribe the post email subscription.",
                  })
              )
            );
        })
      );

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
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        return yield* listSubscribersEffect(args, {
          publicOnly: true,
          userId: session.session.userId,
        });
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostSubscriptionListPublic",
          level: "read",
        }),
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
        RateLimit.withPublicRpcRateLimit({
          name: "PostSubscriptionCreatePublic",
          level: "write",
        }),
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
        RateLimit.withPublicRpcRateLimit({
          name: "PostSubscriptionDeletePublic",
          level: "write",
        }),
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
  Layer.provide(PostSubscriptionRepository.layer),
  Layer.provide(EmailSubscriptionRepository.layer)
);
