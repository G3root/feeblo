import { transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { ChangelogSubscriptionRepository } from "./repository";
import { ChangelogSubscriptionRpcs } from "./rpcs";
import type {
  TChangelogSubscriptionCreate,
  TChangelogSubscriptionDelete,
  TChangelogSubscriptionList,
} from "./schema";

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
              verificationExpiresAt: new Date(now.getTime() + 86_400_000),
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
      subscribeEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogSubscriptionCreate",
          level: "write",
        }),
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            sitePolicy.canViewChangelog(args.organizationId)
          )
        ),
        withRemapDbErrors("ChangelogSubscription", "create")
      ),

    ChangelogSubscriptionCreatePublic: (args: TChangelogSubscriptionCreate) =>
      subscribeEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogSubscriptionCreatePublic",
          level: "write",
        }),
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(args.organizationId),
            sitePolicy.canViewChangelog(args.organizationId)
          )
        ),
        withRemapDbErrors("ChangelogSubscription", "create")
      ),

    ChangelogSubscriptionDelete: (args: TChangelogSubscriptionDelete) =>
      unsubscribeEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogSubscriptionDelete",
          level: "write",
        }),
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            sitePolicy.canViewChangelog(args.organizationId)
          )
        ),
        withRemapDbErrors("ChangelogSubscription", "delete")
      ),

    ChangelogSubscriptionDeletePublic: (args: TChangelogSubscriptionDelete) =>
      unsubscribeEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogSubscriptionDeletePublic",
          level: "write",
        }),
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(args.organizationId),
            sitePolicy.canViewChangelog(args.organizationId)
          )
        ),
        withRemapDbErrors("ChangelogSubscription", "delete")
      ),
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
