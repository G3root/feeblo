import { Polar } from "@polar-sh/sdk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { BadRequestError } from "../rpc-errors";
import { PolarConfig } from "./config";
import {
  FailedToCreateCheckoutError,
  FailedToCreatePortalError,
  FailedToRevokeSubscriptionError,
} from "./errors";

const URLRegex = /\/$/;

/**
 * The shape of a Polar SDK error response. `PolarError` carries `statusCode`;
 * the typed `AlreadyCanceledSubscription` adds the `error` discriminant.
 */
const PolarRevokeFailure = Schema.Struct({
  statusCode: Schema.optional(Schema.Finite),
  error: Schema.optional(Schema.String),
});

/**
 * Whether a rejected revoke means the subscription is already terminated.
 *
 * Polar answers a revoke with 403 `AlreadyCanceledSubscription` for any
 * subscription it no longer considers billable (canceled, unpaid, incomplete,
 * or already ended) and 404 `ResourceNotFound` once the row is gone. Both are
 * achieved outcomes: there is nothing left to charge, so the queue closes the
 * row instead of retrying a refusal that can never change. Other failures —
 * 409 `SubscriptionLocked`, validation errors, transport errors — stay
 * failures.
 */
export const isPolarSubscriptionAlreadyRevoked = (cause: unknown): boolean => {
  const decoded = Schema.decodeUnknownOption(PolarRevokeFailure)(cause);
  return (
    Option.isSome(decoded) &&
    (decoded.value.statusCode === 404 ||
      decoded.value.error === "AlreadyCanceledSubscription")
  );
};

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
            // The workspace is identified by `metadata.org` above, which is
            // the webhook tenancy key. The external customer id only names the
            // customer a first checkout creates: Polar resolves a checkout
            // customer by email before external id and allows one customer per
            // email per organization, so a buyer who pays for several
            // workspaces shares one Polar customer (and its portal). That is a
            // Polar constraint, not an isolation guarantee — which is why
            // account deletion must never delete a Polar customer (see the
            // `createCustomerOnSignUp` note in packages/auth).
            externalCustomerId: organizationId,
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
    /**
     * Immediately cancels a subscription. Used when an organization is deleted
     * so billing does not continue for a tenant that no longer exists.
     *
     * The failure is left in the error channel on purpose: the caller owns the
     * durable retry (the revocation queue), so swallowing it here would lose
     * the only signal that the subscription is still live. "No client" is not
     * a failure — billing is simply not configured, so there is nothing to
     * revoke. A revoke of an already-terminated subscription is reported as
     * `alreadyRevoked` so the queue can close the row rather than retry it.
     */
    revokeSubscription: Effect.fn("PolarService.revokeSubscription")(
      function* ({ id }: { id: string }) {
        if (!client) {
          return;
        }

        yield* Effect.tryPromise({
          try: () => client.subscriptions.revoke({ id }),
          catch: (cause) =>
            new FailedToRevokeSubscriptionError({
              message: "Failed to revoke Polar subscription",
              ...(isPolarSubscriptionAlreadyRevoked(cause) && {
                alreadyRevoked: true,
              }),
            }),
        });
      }
    ),
  };
});

export class PolarService extends Context.Service<PolarService>()(
  "PolarService",
  {
    // The config layer is folded into `make` rather than the static layer
    // (Layer.effect(this, this.make).pipe(Layer.provide(PolarConfig.layer))).
    // The restructure is behaviour-preserving, but billing is an
    // owner-sign-off surface (AGENTS.md), so the mechanical change waits for
    // that sign-off instead of being made quietly.
    // eslint-disable-next-line effecttsgo/strict-effect-provide -- billing surface: needs owner sign-off to restructure
    make: makePolarService.pipe(Effect.provide(PolarConfig.layer)),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
