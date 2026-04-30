import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { BadRequestError, InternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { BillingRepository } from "./repository";
import { BillingRpcs } from "./rpcs";
import { PolarService } from "./service";

export const BillingRpcHandlers = BillingRpcs.toLayer(
  Effect.gen(function* () {
    const polarService = yield* PolarService;
    const repository = yield* BillingRepository;

    return {
      BillingCheckout: ({ organizationId, productId }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* polarService.createCheckout({
            organizationId,
            productId,
            user: {
              id: session.session.userId,
              email: session.user.email,
              name: session.user.name,
            },
          });
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(
                Policy.hasOrganizationRole(organizationId, "owner"),
                Policy.hasOrganizationRole(organizationId, "admin")
              )
            )
          )
        ),
      BillingPortal: ({ organizationId }) =>
        Effect.gen(function* () {
          const subscription =
            yield* repository.findSubscriptionByOrganizationId({
              organizationId,
            });

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
              Policy.any(
                Policy.hasOrganizationRole(organizationId, "owner"),
                Policy.hasOrganizationRole(organizationId, "admin")
              )
            )
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to create billing portal",
                })
              ),
          })
        ),
    };
  })
).pipe(
  Layer.provide(Layer.mergeAll(PolarService.layer, BillingRepository.layer))
);
