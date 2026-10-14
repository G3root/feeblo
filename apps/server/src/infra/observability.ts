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
import { rpcSpanPrefix } from "@feeblo/domain/rpc-router";
import { truncate } from "@feeblo/utils/text";
import * as Sentry from "@sentry/effect/server";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { OtlpExporter } from "effect/observability";
import * as Option from "effect/Option";

import type { ServerConfigValue } from "../config";
import { makeSentryLayer } from "./sentry";
import { telemetryConfig, telemetryLayer } from "./telemetry";
import { defaultTelemetryLogger } from "./telemetry/layer";

/** Longest failure summary written to the startup log. */
const failureSummaryLimit = 500;

/**
 * Credential shapes a config or exporter error can quote back.
 *
 * `telemetryConfig` reads header env vars whose values are backend tokens, and
 * a schema error can carry the offending value in its message. The decoded
 * headers are wrapped in `Redacted`, but the error exists before that wrapper,
 * so strip the shapes here before the summary is logged.
 */
const redactedCredentials = (message: string): string =>
  message
    .replace(/\b(bearer|basic)\s+\S+/gi, "$1 [redacted]")
    .replace(
      /(\b(?:authorization|token|secret|password|passwd|credential|api[-_]?key)[\w.-]*["']?\s*[=:]\s*["']?)(?:(?:basic|bearer)\s+)?\S+/gi,
      "$1[redacted]"
    )
    .replace(/(\bhttps?:\/\/[^/\s:@]+:)[^@\s/]+@/gi, "$1[redacted]@");

/** The message, prefixed with the error tag unless it is a plain `Error`. */
const failureMessage = (error: Error): string =>
  error.name === "Error" ? error.message : `${error.name}: ${error.message}`;

/**
 * One redacted, length-capped line from every message in a startup failure.
 *
 * The startup handlers must not log the raw error or cause: a `SchemaError`
 * carries its whole issue tree, and an error message can quote an OTLP header
 * token. Render only the tags and messages, strip credential-shaped values,
 * and cap the result so one broken value cannot flood the log.
 */
export const failureSummary = (cause: Cause.Cause<unknown>): string =>
  truncate(
    redactedCredentials(
      Cause.prettyErrors(cause).map(failureMessage).join("; ")
    )
      .replaceAll(/\s+/g, " ")
      .trim(),
    failureSummaryLimit
  );

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
        Effect.tapError((error) =>
          Effect.logError(
            "OTLP configuration is invalid; continuing with Sentry only",
            { error: failureSummary(Cause.fail(error)) }
          )
        ),
        Effect.option
      );

      if (Option.isNone(telemetry)) {
        return sentryOnly;
      }
      const { logs, metrics, traces } = telemetry.value;
      const otlpEnabled =
        traces !== undefined || logs !== undefined || metrics !== undefined;
      if (!otlpEnabled) {
        return sentryOnly;
      }

      const loggers: Array<Logger.Logger<unknown, void>> = [
        defaultTelemetryLogger,
      ];
      if (config.sentryDsn && logs === undefined) {
        loggers.push(Sentry.SentryEffectLogger);
      }

      return Layer.mergeAll(
        makeSentryLayer(config, {
          logger: false,
          metrics: metrics === undefined,
          tracer: traces === undefined,
        }),
        telemetryLayer(telemetry.value, {
          baseLoggers: Logger.layer(loggers, { mergeWithExisting: false }),
          rpcSpanPrefix,
        })
      ).pipe(
        Layer.catchCause((cause) =>
          Layer.unwrap(
            Effect.logError(
              "OTLP exporters failed to start; continuing with Sentry only",
              { cause: failureSummary(cause) }
            ).pipe(Effect.as(sentryOnly))
          )
        )
      );
    })
  );
