import { optionalString } from "@feeblo/config/effect";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

const optionalInteger = (name: string, fallback: number) =>
  optionalString(name).pipe(
    Effect.map((value) =>
      Option.isSome(value) && value.value.trim() !== ""
        ? Number(value.value) || fallback
        : fallback
    )
  );

/**
 * Transactional email configuration. All values are optional with safe
 * defaults so the system works out of the box; see `.env.example` for docs.
 */
export class EmailConfig extends Context.Service<EmailConfig>()("EmailConfig", {
  make: Effect.gen(function* () {
    const dailyCapPerRecipient = yield* optionalInteger(
      "EMAIL_DAILY_CAP_PER_RECIPIENT",
      10
    );
    const digestWindow = yield* optionalString("EMAIL_DIGEST_WINDOW").pipe(
      Effect.map((value) => {
        if (Option.isSome(value) && value.value.trim() !== "") {
          try {
            return Duration.fromInputUnsafe(value.value as Duration.Input);
          } catch {
            return Duration.minutes(15);
          }
        }
        return Duration.minutes(15);
      })
    );
    const maxAttempts = yield* optionalInteger("EMAIL_MAX_ATTEMPTS", 8);
    const unsubscribeSecret = yield* optionalString(
      "EMAIL_UNSUBSCRIBE_JWT_SECRET"
    );
    // Optional rotation list (comma-separated, newest first). Tokens are
    // always signed with the primary secret and verified against every
    // candidate, mirroring the jwt-secret rotation pattern.
    const rotationSecrets = yield* optionalString(
      "EMAIL_UNSUBSCRIBE_JWT_SECRETS"
    );

    return {
      dailyCapPerRecipient,
      digestWindow,
      maxAttempts,
      unsubscribeSecrets: Option.isSome(unsubscribeSecret)
        ? [
            unsubscribeSecret.value,
            ...(Option.isSome(rotationSecrets)
              ? rotationSecrets.value
                  .split(",")
                  .map((secret) => secret.trim())
                  .filter(Boolean)
              : []),
          ]
        : [],
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
