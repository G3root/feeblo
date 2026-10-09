import { transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import * as RateLimit from "../rate-limit";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import {
  type Surface,
  type SurfaceConfig,
  withSurfaceRateLimit,
} from "../surface";
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
      slug: args.slug,
      ...(options?.publicOnly !== undefined && {
        publicOnly: options.publicOnly,
      }),
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
              verificationExpiresAt: DateTime.fromDateUnsafe(now).pipe(
                DateTime.addDuration(Duration.days(1)),
                DateTime.toDate
              ),
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

  // -- Surface-parameterized writes --
  //
  // Both bodies above are surface-neutral; the record holds what differs:
  // the dashboard admits members to unlocked posts, the public portal admits
  // restricted sessions to public boards, and only the public portal spends a
  // rate limit.

  const createWrite = {
    dashboard: {
      rateLimit: undefined,
      policy: (args: TPostSubscriptionCreate) =>
        Policy.all(
          Policy.hasMembership(args.organizationId),
          postPolicy.isUnlocked({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
    },
    public: {
      rateLimit: "write",
      policy: (args: TPostSubscriptionCreate) =>
        Policy.all(
          Policy.hasRestrictedOrganizationScope(args.organizationId),
          postPolicy.isUnlockedPublic({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
    },
  } satisfies Record<Surface, SurfaceConfig<TPostSubscriptionCreate>>;

  const deleteWrite = {
    dashboard: {
      rateLimit: undefined,
      policy: (args: TPostSubscriptionDelete) =>
        Policy.all(
          Policy.hasMembership(args.organizationId),
          postPolicy.isUnlocked({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
    },
    public: {
      rateLimit: "write",
      policy: (args: TPostSubscriptionDelete) =>
        Policy.all(
          Policy.hasRestrictedOrganizationScope(args.organizationId),
          postPolicy.isUnlockedPublic({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
    },
  } satisfies Record<Surface, SurfaceConfig<TPostSubscriptionDelete>>;

  const subscribeFor = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TPostSubscriptionCreate
  ) =>
    subscribeEffect(args).pipe(
      Policy.withPolicy(createWrite[surface].policy(args)),
      withRemapDbErrors("PostSubscription", "create"),
      withSurfaceRateLimit({
        level,
        operation: "PostSubscriptionCreate",
        surface,
      })
    );

  const unsubscribeFor = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TPostSubscriptionDelete
  ) =>
    unsubscribeEffect(args).pipe(
      Policy.withPolicy(deleteWrite[surface].policy(args)),
      withRemapDbErrors("PostSubscription", "delete"),
      withSurfaceRateLimit({
        level,
        operation: "PostSubscriptionDelete",
        surface,
      })
    );

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
        // This route runs on `PublicAuthMiddleware`, which admits the restricted
        // sessions that widget SSO mints — so it needs the same organization
        // confinement as `PostSubscriptionCreatePublic` and
        // `PostSubscriptionDeletePublic`. The repository's `userId` predicate is
        // what kept the response to the caller's own rows; this is the control
        // that says the caller may ask about this organization at all.
        Policy.withPolicy(
          Policy.hasRestrictedOrganizationScope(args.organizationId)
        ),
        withRemapDbErrors("PostSubscription", "select")
      ),

    PostSubscriptionCreate: (args: TPostSubscriptionCreate) =>
      subscribeFor("dashboard", createWrite.dashboard.rateLimit, args),

    PostSubscriptionCreatePublic: (args: TPostSubscriptionCreate) =>
      subscribeFor("public", createWrite.public.rateLimit, args),

    PostSubscriptionDelete: (args: TPostSubscriptionDelete) =>
      unsubscribeFor("dashboard", deleteWrite.dashboard.rateLimit, args),

    PostSubscriptionDeletePublic: (args: TPostSubscriptionDelete) =>
      unsubscribeFor("public", deleteWrite.public.rateLimit, args),
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
