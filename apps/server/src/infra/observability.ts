/**
 * The composition root's observability layer.
 *
 * Observability is OTLP-only. When an endpoint is configured, the
 * Effect-native OTLP exporters own traces, logs, and metrics; without one the
 * runtime's default tracer and logger are used. A broken telemetry env var or
 * an exporter that fails to start logs loudly and continues without OTLP
 * rather than taking down a deployment.
 *
 * See `docs/telemetry.md` for the env and the local motel setup.
 */
import { rpcSpanPrefix } from "@feeblo/domain/rpc-router";
import { truncate } from "@feeblo/utils/text";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";

import type { ServerConfigValue } from "../config";
import { telemetryConfig } from "./telemetry/config";
import { telemetryLayer } from "./telemetry/layer";
import { startProcessMetrics } from "./telemetry/process";

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
      const telemetry = yield* telemetryConfig({
        service: "feeblo-server",
        environment: config.environment,
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError(
            "OTLP configuration is invalid; continuing without OTLP exporters",
            { error: failureSummary(Cause.fail(error)) }
          )
        ),
        Effect.option
      );

      // The invalid-configuration path has no decoded log level; the fallbacks
      // below do, so keep `FEEBLO_TELEMETRY_LOG_LEVEL` in effect even when no
      // exporter starts.
      if (Option.isNone(telemetry)) {
        return Layer.empty;
      }
      const { logLevel, logs, metrics, traces } = telemetry.value;
      const otlpEnabled =
        traces !== undefined || logs !== undefined || metrics !== undefined;
      if (!otlpEnabled) {
        return Layer.succeed(References.MinimumLogLevel, logLevel);
      }

      // `provideMerge` gives the sampler the telemetry layer's fresh metric
      // registry, so its gauges reach the same exporter, and keeps the
      // telemetry output in the result.
      return Layer.effectDiscard(startProcessMetrics("feeblo-server")).pipe(
        Layer.provideMerge(telemetryLayer(telemetry.value, { rpcSpanPrefix })),
        Layer.catchCause((cause) =>
          Layer.unwrap(
            Effect.logError(
              "OTLP exporters failed to start; continuing without OTLP exporters",
              { cause: failureSummary(cause) }
            ).pipe(
              Effect.as(Layer.succeed(References.MinimumLogLevel, logLevel))
            )
          )
        )
      );
    })
  );
