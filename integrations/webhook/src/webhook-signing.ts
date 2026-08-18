import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
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
    readonly expiresAt: DateTime.Utc;
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
  WebhookSigningError,
  Crypto.Crypto
> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const bytes = yield* crypto.randomBytes(32);
    return Redacted.make(
      `${signingSecretPrefix}${Buffer.from(bytes).toString("base64")}`
    );
  }).pipe(
    Effect.mapError(() => new WebhookSigningError({ operation: "generate" }))
  );

/** Replaces the active signing key and retains it for the required 24-hour rotation grace period; the clock (and thus TestClock) drives expiry. */
export const rotateWebhookSigningKeyring = (
  keyring: WebhookSigningKeyring
): Effect.Effect<WebhookSigningKeyring, WebhookSigningError, Crypto.Crypto> =>
  Effect.gen(function* () {
    const rotationTime = yield* DateTime.now;
    const current = yield* generateWebhookSigningSecret();
    return {
      current,
      previous: {
        secret: keyring.current,
        expiresAt: DateTime.addDuration(rotationTime, Duration.days(1)),
      },
    };
  });

/** Signs exact UTF-8 JSON text using the stable delivery ID and the current attempt timestamp. */
export const signWebhookDelivery = ({
  deliveryId,
  keyring,
  rawBody,
}: {
  readonly deliveryId: string;
  readonly keyring: WebhookSigningKeyring;
  readonly rawBody: string;
}): Effect.Effect<WebhookSigningHeaders, WebhookSigningError> =>
  Effect.gen(function* () {
    const signingTime = yield* DateTime.now;
    return yield* Effect.try({
      try: () => {
        const signingDate = DateTime.toDate(signingTime);
        const currentSignature = new Webhook(
          Redacted.value(keyring.current)
        ).sign(deliveryId, signingDate, rawBody);
        const priorSignature =
          keyring.previous !== undefined &&
          keyring.previous.expiresAt.epochMilliseconds >
            signingTime.epochMilliseconds
            ? new Webhook(Redacted.value(keyring.previous.secret)).sign(
                deliveryId,
                signingDate,
                rawBody
              )
            : undefined;

        return {
          "webhook-id": deliveryId,
          "webhook-timestamp": String(
            Math.floor(signingTime.epochMilliseconds / 1000)
          ),
          "webhook-signature": [currentSignature, priorSignature]
            .filter((signature): signature is string => signature !== undefined)
            .join(" "),
        };
      },
      catch: () => new WebhookSigningError({ operation: "sign" }),
    });
  });
