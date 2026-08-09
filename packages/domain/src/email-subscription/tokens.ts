import { createHash, randomBytes } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class EmailSubscriptionTokenError extends Schema.TaggedErrorClass<EmailSubscriptionTokenError>()(
  "EmailSubscriptionTokenError",
  {
    operation: Schema.String,
  }
) {}

export type EmailSubscriptionToken = Redacted.Redacted<string>;

/** Creates a random opaque token for one subscription verification or unsubscribe operation. */
export const generateEmailSubscriptionToken: Effect.Effect<
  EmailSubscriptionToken,
  EmailSubscriptionTokenError
> = Effect.try({
  try: () => Redacted.make(randomBytes(32).toString("base64url")),
  catch: () => new EmailSubscriptionTokenError({ operation: "generate" }),
});

/** Hashes a redacted subscription token before it crosses the persistence boundary. */
export const hashEmailSubscriptionToken = (
  token: EmailSubscriptionToken
): Effect.Effect<string, EmailSubscriptionTokenError> =>
  Effect.try({
    try: () =>
      createHash("sha256").update(Redacted.value(token)).digest("hex"),
    catch: () => new EmailSubscriptionTokenError({ operation: "hash" }),
  });

/** Immediately redacts a token received from an unauthenticated verification URL. */
export const redactEmailSubscriptionToken = (
  token: string
): EmailSubscriptionToken => Redacted.make(token);
