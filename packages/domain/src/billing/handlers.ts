import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { CurrentSession } from "../session-middleware";
import { BillingRpcs } from "./rpcs";
import { PolarService } from "./service";

export const BillingRpcHandlers = BillingRpcs.toLayer(
  Effect.gen(function* () {
    const polarService = yield* PolarService;

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
        }).pipe(Policy.withPolicy(Policy.hasMembership(organizationId))),
    };
  })
).pipe(Layer.provide(PolarService.Default));
