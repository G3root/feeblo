import { randomBytes } from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Webhook } from "standardwebhooks";
import { WebhookSigningError } from "./webhook-errors";

/** A signing key is redacted from logs, errors, and ordinary object inspection. */
export type WebhookSigningSecret = Redacted.Redacted<string>;

/** A current key and optional expiring prior key used during endpoint secret rotation. */
export interface WebhookSigningKeyring {
  readonly current: WebhookSigningSecret;
  readonly previous?: {
    readonly expiresAt: Date;
    readonly secret: WebhookSigningSecret;
  };
}

/** Signing headers for a single delivery attempt; its ID stays stable but its timestamp is attempt-local. */
export interface WebhookSigningHeaders {
  readonly "webhook-id": string;
  readonly "webhook-signature": string;
  readonly "webhook-timestamp": string;
}

const signingSecretPrefix = "whsec_";

/** Generates a Standard Webhooks-compatible base64 signing secret. */
export const generateWebhookSigningSecret = (): Effect.Effect<
  WebhookSigningSecret,
  WebhookSigningError
> =>
  Effect.try({
    try: () =>
      Redacted.make(
        `${signingSecretPrefix}${randomBytes(32).toString("base64")}`
      ),
    catch: () => new WebhookSigningError({ operation: "generate" }),
  });

/** Replaces the active signing key and retains it for the required 24-hour rotation grace period. */
export const rotateWebhookSigningKeyring = (
  keyring: WebhookSigningKeyring,
  now?: Date
): Effect.Effect<WebhookSigningKeyring, WebhookSigningError> =>
  Effect.gen(function* () {
    const rotationTime = now ?? (yield* DateTime.nowAsDate);
    const current = yield* generateWebhookSigningSecret();
    return {
      current,
      previous: {
        secret: keyring.current,
        expiresAt: new Date(rotationTime.getTime() + 24 * 60 * 60 * 1000),
      },
    };
  });

/** Signs exact UTF-8 JSON text using the stable delivery ID and the current attempt timestamp. */
export const signWebhookDelivery = ({
  deliveryId,
  keyring,
  now,
  rawBody,
}: {
  readonly deliveryId: string;
  readonly keyring: WebhookSigningKeyring;
  readonly now?: Date;
  readonly rawBody: string;
}): Effect.Effect<WebhookSigningHeaders, WebhookSigningError> =>
  Effect.gen(function* () {
    const signingTime = now ?? (yield* DateTime.nowAsDate);
    return yield* Effect.try({
      try: () => {
        const currentSignature = new Webhook(
          Redacted.value(keyring.current)
        ).sign(deliveryId, signingTime, rawBody);
        const priorSignature =
          keyring.previous !== undefined &&
          keyring.previous.expiresAt > signingTime
            ? new Webhook(Redacted.value(keyring.previous.secret)).sign(
                deliveryId,
                signingTime,
                rawBody
              )
            : undefined;

        return {
          "webhook-id": deliveryId,
          "webhook-timestamp": String(
            Math.floor(signingTime.getTime() / 1000)
          ),
          "webhook-signature": [currentSignature, priorSignature]
            .filter((signature): signature is string => signature !== undefined)
            .join(" "),
        };
      },
      catch: () => new WebhookSigningError({ operation: "sign" }),
    });
  });
