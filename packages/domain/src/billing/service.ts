import { Polar } from "@polar-sh/sdk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { BadRequestError } from "../rpc-errors";
import { PolarConfig } from "./config";
import {
  FailedToCreateCheckoutError,
  FailedToCreatePortalError,
} from "./errors";

const URLRegex = /\/$/;

const makePolarService = Effect.gen(function* () {
  const { accessToken, appUrl, server, webhookSecret } = yield* PolarConfig;

  const client =
    accessToken._tag === "Some"
      ? new Polar({
          accessToken: accessToken.value.pipe(Redacted.value),
          server,
        })
      : undefined;

  const billingBaseUrl = (organizationId: string) =>
    `${appUrl.replace(URLRegex, "")}/${organizationId}/settings/billing`;

  return {
    client,
    webhookSecret,
    createCheckout: Effect.fn("PolarService.createCheckout")(function* ({
      organizationId,
      productId,
      user,
    }: {
      organizationId: string;
      productId: string;
      user: {
        id: string;
        email?: string | null;
        name?: string | null;
      };
    }) {
      if (!client) {
        return yield* new BadRequestError({
          message: "Polar billing is not configured",
        });
      }

      const checkout = yield* Effect.tryPromise({
        try: () =>
          client.checkouts.create({
            products: [productId],
            metadata: {
              org: organizationId,
            },
            externalCustomerId: user.id,
            customerEmail: user.email ?? undefined,
            customerName: user.name ?? undefined,
            successUrl: `${billingBaseUrl(organizationId)}?checkout_id={CHECKOUT_ID}`,
            returnUrl: billingBaseUrl(organizationId),
          }),
        catch: () =>
          new FailedToCreateCheckoutError({
            message: "Failed to create Polar checkout",
          }),
      });

      return {
        url: checkout.url,
      };
    }),
    createPortal: Effect.fn("PolarService.createPortal")(function* ({
      customerId,
    }: {
      customerId: string;
    }) {
      if (!client) {
        return yield* new BadRequestError({
          message: "Polar billing is not configured",
        });
      }

      const portalSession = yield* Effect.tryPromise({
        try: () =>
          client.customerSessions.create({
            customerId,
          }),
        catch: () =>
          new FailedToCreatePortalError({
            message: "Failed to create Polar customer portal session",
          }),
      });

      return {
        url: portalSession.customerPortalUrl,
      };
    }),
  };
});

export class PolarService extends Context.Service<PolarService>()(
  "PolarService",
  {
    make: makePolarService.pipe(Effect.provide(PolarConfig.layer)),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
