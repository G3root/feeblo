import { createPolar, createPolarCore } from "@polar-sh/sdk/2026-10";
import type { webhooks } from "@polar-sh/sdk/2026-10";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { BadRequestError } from "../rpc-errors";
import { PolarConfig } from "./config";
import {
  FailedToConfirmBillingCheckoutError,
  FailedToCreateCheckoutError,
  FailedToCreatePortalError,
  FailedToRevokeSubscriptionError,
} from "./errors";

const URLRegex = /\/$/;

/**
 * The parts of a rejected Polar revoke call this module reads. `PolarError`
 * carries `statusCode`; a typed client error additionally carries the answer
 * body, whose `error` discriminant names the refusal. The body is decoded on
 * its own so a shape it does not recognize can never hide the status code.
 */
const PolarRevokeFailure = Schema.Struct({
  statusCode: Schema.optional(Schema.Finite),
  error: Schema.optional(Schema.Unknown),
});

/** The discriminant of a typed Polar client error's answer body. */
const PolarErrorBody = Schema.Struct({ error: Schema.String });

/** What a rejected revoke tells us about the subscription's fate. */
export interface ClassifiedRevokeFailure {
  /**
   * Polar answered that the subscription is already terminated, so the
   * postcondition a revoke wants already holds.
   */
  readonly alreadyRevoked: boolean;
  /** Polar's HTTP status when the cause was a recognizable error response. */
  readonly statusCode?: number;
  /** Polar's typed error discriminant (`AlreadyCanceledSubscription`, ...). */
  readonly errorTag?: string;
}

/**
 * Reads a rejected revoke's cause into the outcomes the revocation queue acts
 * on.
 *
 * Polar answers a revoke with 403 `AlreadyCanceledSubscription` for any
 * subscription it no longer considers billable (canceled, unpaid, incomplete,
 * or already ended) and a typed 404 `ResourceNotFound` once the row is gone.
 * Both are achieved outcomes: there is nothing left to charge, so the queue
 * closes the row instead of retrying a refusal that can never change. The
 * typed discriminants are matched, not bare status codes: the SDK's generic
 * `PolarError` fallback can carry any status, and closing a row on a 404 that
 * is not a missing subscription would leave a live one billing. Other
 * failures — 409 `SubscriptionLocked`, validation errors, transport errors —
 * stay failures. Transport failures carry neither field, because there is no
 * Polar answer to describe.
 */
export const classifyPolarRevokeFailure = (
  cause: unknown
): ClassifiedRevokeFailure => {
  const decoded = Schema.decodeUnknownOption(PolarRevokeFailure)(cause);
  if (Option.isNone(decoded)) {
    return { alreadyRevoked: false };
  }
  const { statusCode } = decoded.value;
  const error = Option.getOrUndefined(
    Option.map(
      Schema.decodeUnknownOption(PolarErrorBody)(decoded.value.error),
      (body) => body.error
    )
  );
  return {
    alreadyRevoked:
      error === "AlreadyCanceledSubscription" || error === "ResourceNotFound",
    ...(statusCode !== undefined && { statusCode }),
    ...(error !== undefined && { errorTag: error }),
  };
};

/**
 * The diagnostic suffix for a revoke failure's message: the Polar status and
 * typed error when Polar answered, and an explicit "no answer" otherwise, so
 * a transport failure is never mistaken for a classified refusal.
 */
export const describeRevokeFailure = (
  failure: ClassifiedRevokeFailure
): string => {
  if (failure.errorTag !== undefined) {
    return `Polar answered ${failure.statusCode ?? "an unknown status"} ${failure.errorTag}`;
  }
  if (failure.statusCode !== undefined) {
    return `Polar answered HTTP ${failure.statusCode}`;
  }
  return "no Polar answer (transport error)";
};

/**
 * The one Polar organization setting Feeblo's billing behavior depends on.
 * `allowMultipleSubscriptions` is `false` by default, and because a checkout
 * customer is resolved by email (ADR 0013) that default caps a buyer across
 * workspaces — see ADR 0015.
 */
export interface PolarOrganizationSubscriptionSettings {
  readonly allowMultipleSubscriptions: boolean;
}

/** The slice of an organizations list response the settings read needs. */
type OrganizationsWithSettings = {
  readonly items: ReadonlyArray<{
    readonly subscription_settings: {
      readonly allow_multiple_subscriptions: boolean;
    };
  }>;
};

/** The Polar subscription shape the webhook sync and the confirmation share. */
type SubscriptionPayload = webhooks.WebhookSubscriptionCreatedPayload["data"];

/** The subscription snapshot a completed checkout confirms. */
export type SubscriptionConfirmation = {
  readonly subscription: SubscriptionPayload;
  /** Polar's own modification time, used as the webhook-ordering stamp. */
  readonly eventTimestamp: Date;
};

/** The checkout fields the confirmation reads; the rest of the model is unused. */
type CheckoutConfirmationSource = {
  readonly subscription_id: string | null;
  readonly metadata: unknown;
};

/**
 * The two Polar reads the checkout confirmation makes, injected so the
 * ownership checks can be tested without constructing the SDK client.
 */
type CheckoutSubscriptionLookup = {
  readonly getCheckout: (
    checkoutId: string
  ) => Promise<CheckoutConfirmationSource>;
  readonly getSubscription: (
    subscriptionId: string
  ) => Promise<SubscriptionPayload>;
};

/** The `org` key this deployment stamps on a checkout. */
const OrgMetadata = Schema.Struct({ org: Schema.String });

/**
 * Whether a Polar metadata object names this workspace. The caller supplies a
 * checkout id, so both the checkout and the subscription it points at have to
 * carry the workspace id this deployment minted before either is applied.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the type parameter is how this helper accepts any Polar metadata value without spelling `unknown`, which `anti-slop/no-unknown-parameters` bans (the established spelling is `packages/utils/src/runtime-kind.ts`); the parameter is used once by construction
export const metadataBelongsToOrganization = <T>(
  metadata: T,
  organizationId: string
): boolean =>
  Option.match(Schema.decodeUnknownOption(OrgMetadata)(metadata), {
    onNone: () => false,
    onSome: (decoded) => decoded.org === organizationId,
  });

/**
 * Reads the subscription a completed checkout created, so the success page can
 * apply it without waiting for the webhook (the other sync path).
 *
 * `None` means the checkout exists but has no subscription yet: payment is
 * still processing. The workspace check runs on the checkout's metadata and
 * again on the subscription's, because the caller supplies the checkout id:
 * without it, a billing member of one workspace could ask this deployment to
 * record another workspace's subscription. The stamp is the subscription's
 * `modified_at`/`created_at` rather than the current time, so a snapshot the
 * webhook already superseded cannot displace the newer event through
 * `lastEventAt`.
 */
export const readCheckoutSubscription = (
  { getCheckout, getSubscription }: CheckoutSubscriptionLookup,
  {
    organizationId,
    checkoutId,
  }: {
    organizationId: string;
    checkoutId: string;
  }
) =>
  Effect.gen(function* () {
    const checkout = yield* Effect.tryPromise({
      try: () => getCheckout(checkoutId),
      catch: () =>
        new FailedToConfirmBillingCheckoutError({
          message: "Failed to read the Polar checkout",
        }),
    });

    const subscriptionId = checkout.subscription_id;
    if (subscriptionId === null) {
      return Option.none<SubscriptionConfirmation>();
    }

    if (!metadataBelongsToOrganization(checkout.metadata, organizationId)) {
      return yield* new BadRequestError({
        message: "This checkout does not belong to the workspace",
      });
    }

    const subscription = yield* Effect.tryPromise({
      try: () => getSubscription(subscriptionId),
      catch: () =>
        new FailedToConfirmBillingCheckoutError({
          message: "Failed to read the Polar subscription",
        }),
    });

    if (!metadataBelongsToOrganization(subscription.metadata, organizationId)) {
      return yield* new FailedToConfirmBillingCheckoutError({
        message:
          "The Polar subscription does not carry this workspace's metadata",
      });
    }

    return Option.some<SubscriptionConfirmation>({
      subscription,
      eventTimestamp: DateTime.toDateUtc(
        DateTime.makeUnsafe(subscription.modified_at ?? subscription.created_at)
      ),
    });
  });

/**
 * The settings read is best-effort: it drives a startup warning, so this error
 * exists only to keep a failure typed until the read degrades to `None`. It is
 * never surfaced to a caller.
 */
class FailedToReadPolarSettingsError extends Schema.TaggedError<FailedToReadPolarSettingsError>()(
  "FailedToReadPolarSettingsError",
  {
    cause: Schema.Defect(),
  }
) {}

/**
 * Reads the token organization's Polar subscription settings through an
 * `organizations.list` call.
 *
 * Never fails. The settings drive a startup warning, and a diagnostic must not
 * turn an unreachable Polar into a failed boot: a failure is logged and read
 * as `None`, which callers treat as "no guard". The timeout bounds the startup
 * read so a Polar outage cannot hold up composition.
 */
export const readOrganizationSubscriptionSettings = (
  listOrganizations: () => Promise<OrganizationsWithSettings>
) =>
  Effect.tryPromise({
    try: listOrganizations,
    catch: (cause) => new FailedToReadPolarSettingsError({ cause }),
  }).pipe(
    Effect.timeout(Duration.seconds(5)),
    Effect.map((page) =>
      Option.map(
        Option.fromNullishOr(page.items[0]?.subscription_settings),
        (settings) => ({
          allowMultipleSubscriptions: settings.allow_multiple_subscriptions,
        })
      )
    ),
    Effect.tapError((error) =>
      Effect.logWarning(
        "Failed to read Polar organization subscription settings",
        error
      )
    ),
    Effect.orElseSucceed(() =>
      Option.none<PolarOrganizationSubscriptionSettings>()
    )
  );

const makePolarService = Effect.gen(function* () {
  const { accessToken, appUrl, server, webhookSecret } = yield* PolarConfig;

  const clientOptions =
    accessToken._tag === "Some"
      ? {
          accessToken: accessToken.value.pipe(Redacted.value),
          environment: server,
        }
      : undefined;

  // Two views of one configuration. The service calls below use the service
  // client (`createPolar`), whose methods are namespaced per resource. The
  // better-auth plugin takes a core client instead (`createPolarCore`): it
  // resolves its endpoints from the SDK's standalone functions, which are
  // bound to the core request builder. Both read the same `clientOptions`, so
  // the token and the target cannot drift apart.
  const client = clientOptions ? createPolar(clientOptions) : undefined;
  const coreClient = clientOptions ? createPolarCore(clientOptions) : undefined;

  const billingBaseUrl = (organizationId: string) =>
    `${appUrl.replace(URLRegex, "")}/${organizationId}/settings/billing`;

  return {
    client,
    coreClient,
    webhookSecret,
    // The Polar target this deployment talks to. Webhook sync stamps it as
    // the origin on subscription rows, the revocation queue copies it, and a
    // row only ever runs against a target that matches it — so a target
    // change cannot close a row on another server's 404.
    target: server,
    /**
     * The token organization's subscription settings, or `None` when billing
     * is not configured or Polar could not be read. `allowMultipleSubscriptions`
     * is `false` by default, and because a checkout customer is resolved by
     * email (ADR 0013) that default caps a buyer across workspaces — see
     * ADR 0015 and the startup warning in `packages/auth`.
     */
    getOrganizationSettings: Effect.fn("PolarService.getOrganizationSettings")(
      function* () {
        if (!client) {
          return Option.none<PolarOrganizationSubscriptionSettings>();
        }
        return yield* readOrganizationSubscriptionSettings(() =>
          client.organizations.list({ limit: 1 })
        );
      }
    ),
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
            external_customer_id: organizationId,
            customer_email: user.email ?? null,
            customer_name: user.name ?? null,
            success_url: `${billingBaseUrl(organizationId)}?checkout_id={CHECKOUT_ID}`,
            return_url: billingBaseUrl(organizationId),
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
            customer_id: customerId,
          }),
        catch: () =>
          new FailedToCreatePortalError({
            message: "Failed to create Polar customer portal session",
          }),
      });

      return {
        url: portalSession.customer_portal_url,
      };
    }),
    /**
     * Applies the ownership checks to the configured client. The logic lives
     * in `readCheckoutSubscription` so the checkout and subscription metadata
     * guards can be tested without a live Polar client.
     */
    findSubscriptionForCheckout: Effect.fn(
      "PolarService.findSubscriptionForCheckout"
    )(function* ({
      organizationId,
      checkoutId,
    }: {
      organizationId: string;
      checkoutId: string;
    }) {
      if (!client) {
        return Option.none<SubscriptionConfirmation>();
      }

      return yield* readCheckoutSubscription(
        {
          getCheckout: (id) => client.checkouts.get(id),
          getSubscription: (id) => client.subscriptions.get(id),
        },
        { organizationId, checkoutId }
      );
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
          try: () => client.subscriptions.revoke(id),
          catch: (cause) => {
            const classified = classifyPolarRevokeFailure(cause);
            return new FailedToRevokeSubscriptionError({
              // The stable prefix leads a search back to this error; the
              // classified detail tells a failed queue row's `lastError`
              // which refusal keeps recurring.
              message: `Failed to revoke Polar subscription (${describeRevokeFailure(classified)})`,
              ...(classified.alreadyRevoked && { alreadyRevoked: true }),
              ...(classified.statusCode !== undefined && {
                statusCode: classified.statusCode,
              }),
              ...(classified.errorTag !== undefined && {
                errorTag: classified.errorTag,
              }),
            });
          },
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
