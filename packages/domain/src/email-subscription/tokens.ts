import { createHash, createHmac } from "node:crypto";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class EmailSubscriptionTokenError extends Schema.TaggedError<EmailSubscriptionTokenError>()(
  "EmailSubscriptionTokenError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
  }
) {}

export type EmailSubscriptionToken = Redacted.Redacted<string>;

export const EmailSubscriptionTokenPurpose = Schema.Literals([
  "unsubscribe",
  "verification",
]);

export type EmailSubscriptionTokenPurpose = Schema.Schema.Type<
  typeof EmailSubscriptionTokenPurpose
>;

/** Inputs for deriving one purpose-bound email subscription bearer token. */
export interface DeriveEmailSubscriptionTokenInput {
  readonly purpose: EmailSubscriptionTokenPurpose;
  readonly subscriptionId: string;
}

const makeEmailSubscriptionTokenService = Effect.gen(function* () {
  const signingSecret = yield* Config.redacted("AUTH_ENCRYPTION_KEY");

  const deriveToken = Effect.fn("EmailSubscriptionToken.derive")(function* ({
    purpose,
    subscriptionId,
  }: DeriveEmailSubscriptionTokenInput) {
    return yield* Effect.try({
      try: () =>
        Redacted.make(
          createHmac("sha256", Redacted.value(signingSecret))
            .update(`email-subscription:${purpose}:${subscriptionId}`)
            .digest("base64url")
        ),
      catch: (cause) =>
        new EmailSubscriptionTokenError({
          cause,
          message: "Email subscription token derivation failed",
          operation: "derive",
        }),
    });
  });

  return { deriveToken };
});

/** Derives stable, purpose-bound tokens while keeping the signing secret redacted. */
export class EmailSubscriptionTokenService extends Context.Service<EmailSubscriptionTokenService>()(
  "EmailSubscriptionTokenService",
  { make: makeEmailSubscriptionTokenService }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies a redacted signing secret to deterministic token tests. */
  static readonly layerTest = (signingSecret: string) =>
    Layer.effect(
      this,
      Effect.succeed(
        this.of({
          deriveToken: ({ purpose, subscriptionId }) =>
            Effect.try({
              try: () =>
                Redacted.make(
                  createHmac("sha256", signingSecret)
                    .update(`email-subscription:${purpose}:${subscriptionId}`)
                    .digest("base64url")
                ),
              catch: (cause) =>
                new EmailSubscriptionTokenError({
                  cause,
                  message: "Email subscription token derivation failed",
                  operation: "derive",
                }),
            }),
        })
      )
    );
}

/** Hashes a redacted subscription token before it crosses the persistence boundary. */
export const hashEmailSubscriptionToken = (
  token: EmailSubscriptionToken
): Effect.Effect<string, EmailSubscriptionTokenError> =>
  Effect.try({
    try: () => createHash("sha256").update(Redacted.value(token)).digest("hex"),
    catch: (cause) =>
      new EmailSubscriptionTokenError({
        cause,
        message: "Email subscription token hashing failed",
        operation: "hash",
      }),
  });

/** Immediately redacts a token received from an unauthenticated verification URL. */
export const redactEmailSubscriptionToken = (
  token: string
): EmailSubscriptionToken => Redacted.make(token);
