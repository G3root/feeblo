import { createHmac, timingSafeEqual } from "node:crypto";

import { NotificationPreferenceCategory } from "@feeblo/db/validation-schema/notification-preference";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class NotificationPreferenceTokenError extends Schema.TaggedError<NotificationPreferenceTokenError>()(
  "NotificationPreferenceTokenError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
  }
) {}

/** The claims one member unsubscribe link carries; never a secret by itself. */
export const NotificationPreferenceUnsubscribeClaims = Schema.Struct({
  category: NotificationPreferenceCategory,
  organizationId: Schema.String,
  userId: Schema.String,
});

export type NotificationPreferenceUnsubscribeClaims = Schema.Schema.Type<
  typeof NotificationPreferenceUnsubscribeClaims
>;

export type NotificationPreferenceUnsubscribeToken = Redacted.Redacted<string>;

const tokenPrefix = "notification-preference:unsubscribe";

/**
 * The claims codec as JSON text: the token's payload is a signed JSON string,
 * so the codec is declared once here instead of a `JSON.stringify`/`parse`
 * pair that could drift from the schema.
 */
const ClaimsJson = Schema.fromJsonString(
  NotificationPreferenceUnsubscribeClaims
);
const encodeClaims = Schema.encodeSync(ClaimsJson);
const decodeClaims = Schema.decodeUnknownOption(ClaimsJson);

const sign = (signingSecret: string, payload: string): string =>
  createHmac("sha256", signingSecret)
    .update(`${tokenPrefix}:${payload}`)
    .digest("base64url");

const makeNotificationPreferenceTokenService = Effect.gen(function* () {
  const signingSecret = yield* Config.Redacted("AUTH_ENCRYPTION_KEY");
  return makeTokenService(Redacted.value(signingSecret));
});

/**
 * Derives and verifies the stateless bearer token in a member email's
 * one-click unsubscribe URL.
 *
 * The token is `base64url(claims).hmac` rather than a stored secret: the
 * claims are exactly the row the click writes (`organizationId`, `userId`,
 * `category`), and the signature is what makes them unforgeable. Nothing is
 * persisted per delivery, so an unsubscribe link cannot leak or expire and a
 * replayed click stays idempotent.
 */
const makeTokenService = (signingSecret: string) => ({
  deriveToken: ({
    category,
    organizationId,
    userId,
  }: NotificationPreferenceUnsubscribeClaims) =>
    Effect.try({
      try: () => {
        const payload = Buffer.from(
          encodeClaims({ category, organizationId, userId }),
          "utf8"
        ).toString("base64url");
        return Redacted.make(`${payload}.${sign(signingSecret, payload)}`);
      },
      catch: (cause) =>
        new NotificationPreferenceTokenError({
          cause,
          message: "Notification preference token derivation failed",
          operation: "derive",
        }),
    }),

  verifyToken: (
    token: string
  ): Effect.Effect<
    Option.Option<NotificationPreferenceUnsubscribeClaims>,
    NotificationPreferenceTokenError
  > =>
    Effect.try({
      try: () => {
        const [payload, signature] = token.split(".");
        if (payload === undefined || signature === undefined) {
          return Option.none();
        }
        const expected = sign(signingSecret, payload);
        const provided = Buffer.from(signature, "utf8");
        const expectedBuffer = Buffer.from(expected, "utf8");
        if (
          provided.length !== expectedBuffer.length ||
          !timingSafeEqual(provided, expectedBuffer)
        ) {
          return Option.none();
        }
        const decoded = Buffer.from(payload, "base64url").toString("utf8");
        return decodeClaims(decoded);
      },
      catch: (cause) =>
        new NotificationPreferenceTokenError({
          cause,
          message: "Notification preference token verification failed",
          operation: "verify",
        }),
    }),
});

/** Derives and verifies member preference unsubscribe tokens. */
export class NotificationPreferenceTokenService extends Context.Service<NotificationPreferenceTokenService>()(
  "NotificationPreferenceTokenService",
  { make: makeNotificationPreferenceTokenService }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies a signing secret to deterministic token tests. */
  static readonly layerTest = (signingSecret: string) =>
    Layer.effect(
      this,
      Effect.succeed(this.of(makeTokenService(signingSecret)))
    );
}
