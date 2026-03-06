import { Polar } from "@polar-sh/sdk";
import { Config, Effect, Redacted, Schema } from "effect";
import { BadRequestError } from "../rpc-errors";
import { FailedToCreateCheckoutError } from "./errors";

const PolarModeConfig = Schema.Config(
  "POLAR_MODE",
  Schema.Literal("sandbox", "production")
).pipe(Config.withDefault("sandbox"));

const URLRegex = /\/$/;

export class PolarService extends Effect.Service<PolarService>()(
  "PolarService",
  {
    effect: Effect.gen(function* () {
      const appUrl = yield* Config.string("VITE_APP_URL");
      const accessToken = yield* Config.redacted("POLAR_ACCESS_TOKEN").pipe(
        Config.option
      );
      const webhookSecret = yield* Config.redacted("POLAR_WEBHOOK_SECRET").pipe(
        Config.option
      );
      const server = yield* PolarModeConfig;

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
        createCheckout: ({
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
        }) =>
          Effect.gen(function* () {
            if (!client) {
              return yield* Effect.fail(
                new BadRequestError({
                  message: "Polar billing is not configured",
                })
              );
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
      };
    }),
  }
) {}
