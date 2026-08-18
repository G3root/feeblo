import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { BillingRepository } from "./repository";
import { BillingRpcs } from "./rpcs";
import type { TBillingCheckoutInput, TBillingPortalInput } from "./schema";
import { PolarService } from "./service";

export const BillingRpcHandlersEffect = Effect.gen(function* () {
  const polarService = yield* PolarService;
  const repository = yield* BillingRepository;

  return {
    BillingCheckout: ({ organizationId, productId }: TBillingCheckoutInput) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const product = yield* repository.findCheckoutProduct({ productId });

        if (Option.isNone(product)) {
          return yield* new BadRequestError({
            message: "This billing product is unavailable",
          });
        }

        const currentSubscription =
          yield* repository.findCurrentSubscriptionByOrganizationId({
            organizationId,
          });

        if (Option.isSome(currentSubscription)) {
          return yield* new BadRequestError({
            message: "Manage the existing subscription in the billing portal",
          });
        }

        return yield* polarService.createCheckout({
          organizationId,
          productId,
          user: {
            email: session.user.email,
            name: session.user.name,
          },
        });
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(organizationId),
            Policy.canPermission(organizationId, "billing.*")
          )
        ),
        withRemapDbErrors("Billing", "select")
      ),
    BillingPortal: ({ organizationId }: TBillingPortalInput) =>
      Effect.gen(function* () {
        const subscription = yield* repository.findSubscriptionByOrganizationId(
          {
            organizationId,
          }
        );

        if (subscription._tag === "None") {
          return yield* new BadRequestError({
            message: "No active subscription found",
          });
        }

        return yield* polarService.createPortal({
          customerId: subscription.value.customerId,
        });
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(organizationId),
            Policy.canPermission(organizationId, "billing.*")
          )
        ),
        withRemapDbErrors("Billing", "select")
      ),
  };
});

export const BillingRpcHandlers = BillingRpcs.toLayer(
  BillingRpcHandlersEffect
).pipe(
  Layer.provide(Layer.mergeAll(PolarService.layer, BillingRepository.layer))
);
