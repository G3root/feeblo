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
    // Shared provider send budget (sends/second), fail-open. The dispatcher
    // consumes one token per send and delays the whole batch when exceeded.
    const providerSendsPerSecond = yield* optionalInteger(
      "EMAIL_PROVIDER_SENDS_PER_SECOND",
      10
    );
    const unsubscribeSecret = yield* optionalString(
      "EMAIL_UNSUBSCRIBE_JWT_SECRET"
    );
    // Optional rotation list (comma-separated, newest first). Tokens are
    // always signed with the primary secret and verified against every
    // candidate, mirroring the jwt-secret rotation pattern.
    const rotationSecrets = yield* optionalString(
      "EMAIL_UNSUBSCRIBE_JWT_SECRETS"
    );
    // Optional shared secret for webhook ingestion (bounce/complaint).
    // When set, requests must carry `X-Feeblo-Signature: sha256=<hmac>`.
    const webhookSecret = yield* optionalString("EMAIL_WEBHOOK_SECRET");
    // Alert (log, picked up by Sentry) when failed events in the last 24h
    // reach this count.
    const consecutiveFailuresAlertThreshold = yield* optionalInteger(
      "EMAIL_CONSECUTIVE_FAILURES_ALERT_THRESHOLD",
      5
    );
    // SMTP is considered configured when a host or service is explicitly
    // provided (MailerConfig defaults to 127.0.0.1:2500 otherwise).
    const smtpHost = yield* optionalString("SMTP_HOST");
    const smtpService = yield* optionalString("SMTP_SERVICE");

    return {
      consecutiveFailuresAlertThreshold,
      dailyCapPerRecipient,
      digestWindow,
      maxAttempts,
      providerSendsPerSecond,
      smtpConfigured: smtpHost._tag === "Some" || smtpService._tag === "Some",
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
      webhookSecret: Option.isSome(webhookSecret) ? webhookSecret.value : null,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
