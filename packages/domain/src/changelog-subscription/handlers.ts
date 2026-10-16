import { transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { definePublicEntry, defineSurfacePair } from "../surface";
import { ChangelogSubscriptionRepository } from "./repository";
import { ChangelogSubscriptionRpcs } from "./rpcs";
import type {
  TChangelogSubscriptionCreate,
  TChangelogSubscriptionDelete,
  TChangelogSubscriptionList,
} from "./schema";

/** The RPCs this group declares; a surface pair's operation must be one. */
type ChangelogSubscriptionRpcTag = RpcTagsOf<typeof ChangelogSubscriptionRpcs>;

export const ChangelogSubscriptionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ChangelogSubscriptionRepository;
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const sitePolicy = yield* SitePolicy;

  // -- Shared effect helpers (no policy applied) --

  const listSubscribersEffect = (
    args: TChangelogSubscriptionList,
    options?: { userId?: string }
  ) =>
    repository.findSubscribers({
      organizationId: args.organizationId,
      ...(options?.userId !== undefined && { userId: options.userId }),
    });

  const subscribeEffect = (args: TChangelogSubscriptionCreate) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      const now = yield* DateTime.nowAsDate;
      yield* transaction(
        Effect.gen(function* () {
          yield* repository.subscribe({
            organizationId: args.organizationId,
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
              topic: { topicId: null, topicType: "changelog" },
              verificationExpiresAt: DateTime.fromDateUnsafe(now).pipe(
                DateTime.addDuration(Duration.days(1)),
                DateTime.toDate
              ),
            })
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({
                    message:
                      "Could not record the changelog email subscription.",
                  })
              )
            );
        })
      );

      return { subscribed: true };
    });

  const unsubscribeEffect = (args: TChangelogSubscriptionDelete) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;

      yield* transaction(
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          yield* repository.unsubscribe({
            organizationId: args.organizationId,
            userId: session.session.userId,
          });
          yield* emailSubscriptions
            .unsubscribeAuthenticatedSubscription({
              now,
              organizationId: args.organizationId,
              topic: { topicId: null, topicType: "changelog" },
              userId: session.session.userId,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({
                    message:
                      "Could not unsubscribe the changelog email subscription.",
                  })
              )
            );
        })
      );

      return { subscribed: false };
    });

  // -- Surface-parameterized writes --
  //
  // Both surfaces spend the same write limit; only the session scope differs:
  // a member on the dashboard, a restricted widget session on the portal.

  const createWrite = defineSurfacePair<
    TChangelogSubscriptionCreate,
    ChangelogSubscriptionRpcTag
  >()({
    operation: "CreateChangelogSubscription",
    remap: { action: "create", entity: "ChangelogSubscription" },
    dashboard: {
      rateLimit: "write",
      policy: (args: TChangelogSubscriptionCreate) =>
        Policy.all(
          Policy.hasMembership(args.organizationId),
          sitePolicy.canViewChangelog(args.organizationId)
        ),
    },
    public: {
      rateLimit: "write",
      policy: (args: TChangelogSubscriptionCreate) =>
        Policy.all(
          Policy.hasRestrictedOrganizationScope(args.organizationId),
          sitePolicy.canViewChangelog(args.organizationId)
        ),
    },
  });

  const deleteWrite = defineSurfacePair<
    TChangelogSubscriptionDelete,
    ChangelogSubscriptionRpcTag
  >()({
    operation: "DeleteChangelogSubscription",
    remap: { action: "delete", entity: "ChangelogSubscription" },
    dashboard: {
      rateLimit: "write",
      policy: (args: TChangelogSubscriptionDelete) =>
        Policy.all(
          Policy.hasMembership(args.organizationId),
          sitePolicy.canViewChangelog(args.organizationId)
        ),
    },
    public: {
      rateLimit: "write",
      policy: (args: TChangelogSubscriptionDelete) =>
        Policy.all(
          Policy.hasRestrictedOrganizationScope(args.organizationId),
          sitePolicy.canViewChangelog(args.organizationId)
        ),
    },
  });

  const subscribe = createWrite.handlers((_surface, args) =>
    subscribeEffect(args)
  );

  const unsubscribe = deleteWrite.handlers((_surface, args) =>
    unsubscribeEffect(args)
  );

  // The dashboard list is the subscriber roster; the public list is the
  // viewer's own subscription, so the pair does not apply and the dashboard
  // half stays hand-written.
  const listPublicEntry = definePublicEntry<
    TChangelogSubscriptionList,
    ChangelogSubscriptionRpcTag
  >()({
    operation: "ListChangelogSubscriptions",
    remap: { action: "select", entity: "ChangelogSubscription" },
    config: {
      rateLimit: "read",
      policy: (args, _surface) =>
        Policy.all(
          Policy.hasRestrictedOrganizationScope(args.organizationId),
          sitePolicy.canViewChangelog(args.organizationId)
        ),
    },
  });

  // -- RPC handlers --

  return {
    ListChangelogSubscriptions: (args: TChangelogSubscriptionList) =>
      listSubscribersEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ListChangelogSubscriptions",
          level: "read",
        }),
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("ChangelogSubscription", "select")
      ),

    // Public boards only ever need the current visitor's own subscription to
    // render the toggle; unlike post subscriptions there is no subscriber
    // showcase, so other users' rows are never exposed.
    ListChangelogSubscriptionsPublic: listPublicEntry.entry((args) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        return yield* listSubscribersEffect(args, {
          userId: session.session.userId,
        });
      })
    ),

    CreateChangelogSubscription: subscribe.dashboard,

    CreateChangelogSubscriptionPublic: subscribe.public,

    DeleteChangelogSubscription: unsubscribe.dashboard,

    DeleteChangelogSubscriptionPublic: unsubscribe.public,
  };
});

export const ChangelogSubscriptionRpcHandlers =
  ChangelogSubscriptionRpcs.toLayer(
    ChangelogSubscriptionRpcHandlersEffect
  ).pipe(
    Layer.provide(ChangelogSubscriptionRepository.layer),
    Layer.provide(EmailSubscriptionRepository.layer),
    Layer.provide(SitePolicy.layer.pipe(Layer.provide(SiteRepository.layer)))
  );
