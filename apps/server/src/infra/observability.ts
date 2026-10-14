import { rpcSpanPrefix } from "@feeblo/domain/rpc-router";
/**
 * The composition root's observability layer.
 *
 * Sentry stays the error channel. When an OTLP endpoint is configured, the
 * Effect-native OTLP exporters take over traces, and optionally logs and
 * metrics, because Effect carries a single `Tracer.Tracer` and one tracer must
 * win. Without an endpoint this is exactly the Sentry layer as before, so
 * local development and self-hosting keep working with no collector.
 *
 * See `docs/telemetry.md` for the env and the local motel setup.
 */
import * as Sentry from "@sentry/effect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { OtlpExporter } from "effect/observability";

import type { ServerConfigValue } from "../config";
import { makeSentryLayer } from "./sentry";
import { telemetryConfig, telemetryLayer } from "./telemetry";
import { defaultTelemetryLogger } from "./telemetry/layer";

export const makeObservabilityLayer = (config: ServerConfigValue) =>
  Layer.unwrap(
    Effect.gen(function* () {
      // Sentry-only is also the fallback when OTLP configuration is broken: a
      // typo in a telemetry env var logs loudly but must not take down a
      // deployment.
      const sentryOnly = Layer.merge(
        makeSentryLayer(config),
        OtlpExporter.layerFlusher
      );
      const telemetry = yield* telemetryConfig({
        service: "feeblo-server",
        environment: config.environment,
      }).pipe(
        Effect.catch((error) =>
          Effect.logError(
            "OTLP configuration is invalid; continuing with Sentry only",
            { error }
          ).pipe(Effect.as(undefined))
        )
      );

      if (telemetry === undefined) {
        return sentryOnly;
      }
      const otlpEnabled =
        telemetry.traces !== undefined ||
        telemetry.logs !== undefined ||
        telemetry.metrics !== undefined;
      if (!otlpEnabled) {
        return sentryOnly;
      }

      const loggers: Array<Logger.Logger<unknown, void>> = [
        defaultTelemetryLogger,
      ];
      if (config.sentryDsn && telemetry.logs === undefined) {
        loggers.push(Sentry.SentryEffectLogger);
      }

      return Layer.mergeAll(
        makeSentryLayer(config, {
          logger: false,
          metrics: telemetry.metrics === undefined,
          tracer: telemetry.traces === undefined,
        }),
        telemetryLayer(telemetry, {
          baseLoggers: Logger.layer(loggers, { mergeWithExisting: false }),
          rpcSpanPrefix,
        })
      ).pipe(
        Layer.catchCause((cause) =>
          Layer.unwrap(
            Effect.logError(
              "OTLP exporters failed to start; continuing with Sentry only",
              { cause }
            ).pipe(Effect.as(sentryOnly))
          )
        )
      );
    })
  );
