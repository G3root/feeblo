import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EmailConfig } from "./config";
import { EmailEventRepository } from "./repository";

export type EmailHealth = {
  readonly smtpConfigured: boolean;
  readonly lastSuccessfulSendAt: Date | null;
  readonly recentFailedEvents: number;
};

const makeEmailHealthService = Effect.gen(function* () {
  const config = yield* EmailConfig;
  const repository = yield* EmailEventRepository;

  /** Delivery pipeline health for the `/health` endpoint. */
  const health = () =>
    Effect.gen(function* () {
      const lastSuccessfulSendAt = yield* repository.lastSuccessfulSendAt();
      const recentFailedEvents = yield* repository.recentFailedEvents(
        new Date(Date.now() - Duration.toMillis(Duration.hours(24)))
      );
      return {
        smtpConfigured: config.smtpConfigured,
        lastSuccessfulSendAt,
        recentFailedEvents,
      };
    });

  /**
   * Alerts when the recent-failure count crosses the configured threshold.
   * Logs an error (captured by the existing Sentry logger wiring when
   * enabled); never fails the caller.
   */
  const checkAndAlert = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const current = yield* health();
      if (
        current.recentFailedEvents >= config.consecutiveFailuresAlertThreshold
      ) {
        yield* Effect.logError(
          "Email delivery failure rate above alert threshold",
          {
            recentFailedEvents: current.recentFailedEvents,
            threshold: config.consecutiveFailuresAlertThreshold,
            lastSuccessfulSendAt:
              current.lastSuccessfulSendAt?.toISOString() ?? null,
          }
        );
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Email health check failed", cause)
      )
    );

  return { checkAndAlert, health } as const;
});

export class EmailHealthService extends Context.Service<EmailHealthService>()(
  "EmailHealthService",
  { make: makeEmailHealthService.pipe(Effect.provide(EmailConfig.layer)) }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(EmailEventRepository.layer)
  );
}
