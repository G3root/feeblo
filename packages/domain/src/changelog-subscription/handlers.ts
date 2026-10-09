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
import {
  type Surface,
  type SurfacePair,
  withSurfaceRateLimit,
} from "../surface";
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

  const createWrite = {
    operation: "ChangelogSubscriptionCreate",
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
  } satisfies SurfacePair<
    TChangelogSubscriptionCreate,
    ChangelogSubscriptionRpcTag
  >;

  const deleteWrite = {
    operation: "ChangelogSubscriptionDelete",
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
  } satisfies SurfacePair<
    TChangelogSubscriptionDelete,
    ChangelogSubscriptionRpcTag
  >;

  const subscribeFor = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TChangelogSubscriptionCreate
  ) =>
    subscribeEffect(args).pipe(
      Policy.withPolicy(createWrite[surface].policy(args)),
      withRemapDbErrors("ChangelogSubscription", "create"),
      withSurfaceRateLimit({
        level,
        operation: createWrite.operation,
        surface,
      })
    );

  const unsubscribeFor = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TChangelogSubscriptionDelete
  ) =>
    unsubscribeEffect(args).pipe(
      Policy.withPolicy(deleteWrite[surface].policy(args)),
      withRemapDbErrors("ChangelogSubscription", "delete"),
      withSurfaceRateLimit({
        level,
        operation: deleteWrite.operation,
        surface,
      })
    );

  // -- RPC handlers --

  return {
    ChangelogSubscriptionList: (args: TChangelogSubscriptionList) =>
      listSubscribersEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogSubscriptionList",
          level: "read",
        }),
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("ChangelogSubscription", "select")
      ),

    /**
     * Public boards only ever need the current visitor's own subscription to
     * render the toggle; unlike post subscriptions there is no subscriber
     * showcase, so other users' rows are never exposed.
     */
    ChangelogSubscriptionListPublic: (args: TChangelogSubscriptionList) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        return yield* listSubscribersEffect(args, {
          userId: session.session.userId,
        });
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogSubscriptionListPublic",
          level: "read",
        }),
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(args.organizationId),
            sitePolicy.canViewChangelog(args.organizationId)
          )
        ),
        withRemapDbErrors("ChangelogSubscription", "select")
      ),

    ChangelogSubscriptionCreate: (args: TChangelogSubscriptionCreate) =>
      subscribeFor("dashboard", createWrite.dashboard.rateLimit, args),

    ChangelogSubscriptionCreatePublic: (args: TChangelogSubscriptionCreate) =>
      subscribeFor("public", createWrite.public.rateLimit, args),

    ChangelogSubscriptionDelete: (args: TChangelogSubscriptionDelete) =>
      unsubscribeFor("dashboard", deleteWrite.dashboard.rateLimit, args),

    ChangelogSubscriptionDeletePublic: (args: TChangelogSubscriptionDelete) =>
      unsubscribeFor("public", deleteWrite.public.rateLimit, args),
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
