import { attachCause, transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession } from "../session-middleware";
import { definePublicEntry, defineSurfacePair } from "../surface";
import { PostSubscriptionRepository } from "./repository";
import { PostSubscriptionRpcs } from "./rpcs";
import type {
  TPostSubscriptionCreate,
  TPostSubscriptionDelete,
  TPostSubscriptionList,
} from "./schema";

/** The RPCs this group declares; a surface pair's operation must be one. */
type PostSubscriptionRpcTag = RpcTagsOf<typeof PostSubscriptionRpcs>;

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
              Effect.mapError((error) =>
                attachCause(
                  new InternalServerError({
                    message: "Could not record the post email subscription.",
                  }),
                  error
                )
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
              Effect.mapError((error) =>
                attachCause(
                  new InternalServerError({
                    message:
                      "Could not unsubscribe the post email subscription.",
                  }),
                  error
                )
              )
            );
        })
      );

      return { subscribed: false };
    });

  // -- Surface-parameterized writes --
  //
  // Both bodies above are surface-neutral; the pair holds what differs:
  // the dashboard admits members to unlocked posts, the public portal admits
  // restricted sessions to public boards, and only the public portal spends a
  // rate limit.

  const createWrite = defineSurfacePair<
    TPostSubscriptionCreate,
    PostSubscriptionRpcTag
  >()({
    operation: "CreatePostSubscription",
    remap: { action: "create", entity: "PostSubscription" },
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
  });

  const deleteWrite = defineSurfacePair<
    TPostSubscriptionDelete,
    PostSubscriptionRpcTag
  >()({
    operation: "DeletePostSubscription",
    remap: { action: "delete", entity: "PostSubscription" },
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
  });

  const subscribe = createWrite.handlers((_surface, args) =>
    subscribeEffect(args)
  );

  const unsubscribe = deleteWrite.handlers((_surface, args) =>
    unsubscribeEffect(args)
  );

  // The public list is the viewer's own subscription; the dashboard list is
  // the subscriber roster, so the pair does not apply and the dashboard half
  // stays hand-written.
  const listPublicEntry = definePublicEntry<
    TPostSubscriptionList,
    PostSubscriptionRpcTag
  >()({
    operation: "ListPostSubscriptions",
    remap: { action: "select", entity: "PostSubscription" },
    config: {
      rateLimit: "read",
      // This route runs on `PublicAuthMiddleware`, which admits the restricted
      // sessions that widget SSO mints — so it needs the same organization
      // confinement as `CreatePostSubscriptionPublic` and
      // `DeletePostSubscriptionPublic`. The repository's `userId` predicate is
      // what kept the response to the caller's own rows; this is the control
      // that says the caller may ask about this organization at all.
      policy: (args, _surface) =>
        Policy.hasRestrictedOrganizationScope(args.organizationId),
    },
  });

  // -- RPC handlers --

  return {
    ListPostSubscriptions: (args: TPostSubscriptionList) =>
      listSubscribersEffect(args).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("PostSubscription", "select")
      ),

    ListPostSubscriptionsPublic: listPublicEntry.entry((args) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        return yield* listSubscribersEffect(args, {
          publicOnly: true,
          userId: session.session.userId,
        });
      })
    ),

    CreatePostSubscription: subscribe.dashboard,

    CreatePostSubscriptionPublic: subscribe.public,

    DeletePostSubscription: unsubscribe.dashboard,

    DeletePostSubscriptionPublic: unsubscribe.public,
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
