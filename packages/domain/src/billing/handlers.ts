import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { BillingRepository } from "./repository";
import { BillingRpcs } from "./rpcs";
import type {
  TBillingCheckoutConfirmationInput,
  TBillingCheckoutInput,
  TBillingPortalInput,
} from "./schema";
import { PolarService } from "./service";

export const BillingRpcHandlersEffect = Effect.gen(function* () {
  const polarService = yield* PolarService;
  const repository = yield* BillingRepository;

  return {
    CreateBillingCheckout: ({
      organizationId,
      productId,
    }: TBillingCheckoutInput) =>
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
    CreateBillingPortal: ({ organizationId }: TBillingPortalInput) =>
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
    /**
     * Applies the subscription a completed checkout created, without waiting
     * for Polar's webhook. The webhook remains the authoritative sync; this is
     * the success-page fast path for a delivery that is delayed or lost, and
     * the repository's `lastEventAt` guard keeps it from replaying an older
     * snapshot over a newer event.
     */
    ConfirmBillingCheckout: ({
      organizationId,
      checkoutId,
    }: TBillingCheckoutConfirmationInput) =>
      Effect.gen(function* () {
        const confirmation = yield* polarService.findSubscriptionForCheckout({
          organizationId,
          checkoutId,
        });

        if (Option.isNone(confirmation)) {
          return;
        }

        yield* repository.upsertSubscription(
          confirmation.value.subscription,
          confirmation.value.eventTimestamp
        );
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(organizationId),
            Policy.canPermission(organizationId, "billing.*")
          )
        ),
        withRemapDbErrors("Billing", "update")
      ),
  };
});

export const BillingRpcHandlers = BillingRpcs.toLayer(
  BillingRpcHandlersEffect
).pipe(
  // PolarService is provided into the repository layer (which reads the
  // configured target from it) and merged alongside it, because the handlers
  // effect reads the service directly. Merging it only as a sibling would
  // leave the requirement unresolved for the composition root.
  Layer.provide(
    Layer.mergeAll(
      BillingRepository.layer.pipe(Layer.provide(PolarService.layer)),
      PolarService.layer
    )
  )
);
