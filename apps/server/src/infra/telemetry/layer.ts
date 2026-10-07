/**
 * OTLP exporters for traces, logs, and metrics.
 *
 * `effect/observability` (built into `effect@4`) ships the OTLP/HTTP exporters;
 * this layer only wires them to the parsed config and keeps one base logger in
 * front of them. Each signal is built only when its endpoint is configured, so
 * an empty `OTEL_EXPORTER_OTLP_ENDPOINT` costs nothing. Ported from
 * `UsefulSoftwareCo/executor`'s `packages/telemetry/src/layer.ts`.
 */
import * as Context from "effect/Context";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import {
  OtlpLogger,
  OtlpMetrics,
  OtlpSerialization,
  OtlpTracer,
} from "effect/observability";
import * as Redacted from "effect/Redacted";
import * as Tracer from "effect/Tracer";

import type { TelemetryConfig, TelemetryTarget } from "./config";
import { allowedSpans } from "./span-attributes";

/**
 * The base logger every signal shares: structured JSON on the console, so a
 * collector outage never silences the process.
 */
export const defaultTelemetryLogger: Logger.Logger<unknown, void> =
  Logger.withConsoleError(Logger.formatJson);

export const telemetryLayer = (
  config: TelemetryConfig,
  options?: {
    readonly lifetime?: "process" | "event" | undefined;
    readonly baseLoggers?: Layer.Layer<never, never, never> | undefined;
  }
) => {
  const lifetime = options?.lifetime ?? "process";
  const baseLoggers =
    options?.baseLoggers ??
    Logger.layer([defaultTelemetryLogger], { mergeWithExisting: false });
  const resource = {
    serviceName: config.service,
    serviceVersion: config.version,
    attributes: { "deployment.environment.name": config.environment },
  };
  const signal = (target: TelemetryTarget) => {
    const common = {
      url: target.url,
      resource,
      exportInterval:
        lifetime === "event" ? ("1 hour" as const) : ("1 second" as const),
      shutdownTimeout: "3 seconds" as const,
    };
    return target.headers === undefined
      ? common
      : { ...common, headers: Redacted.value(target.headers) };
  };
  return Layer.mergeAll(
    config.traces === undefined
      ? Layer.empty
      : OtlpTracer.layer(signal(config.traces)).pipe(
          Layer.provide(OtlpSerialization.layerJson),
          Layer.provide(FetchHttpClient.layer),
          // Wrap the exporter's tracer with the attribute filter and ratio
          // sampling. `flatMap` replaces the layer output with a value, so the
          // `Tracer.Tracer` reference is provided without appearing in the
          // declared output — which is what lets consumers stop requiring it.
          Layer.flatMap((context) =>
            Layer.succeed(
              Tracer.Tracer,
              allowedSpans(Context.get(context, Tracer.Tracer), {
                sampleRate: config.tracesSampleRate,
              })
            )
          )
        ),
    config.logs === undefined
      ? baseLoggers
      : OtlpLogger.layer({
          ...signal(config.logs),
          mergeWithExisting: true,
        }).pipe(
          Layer.provide(OtlpSerialization.layerJson),
          Layer.provideMerge(baseLoggers)
        ),
    config.metrics === undefined
      ? Layer.empty
      : OtlpMetrics.layer({
          ...signal(config.metrics),
          exportInterval: "30 seconds",
          temporality: "delta",
        }).pipe(
          Layer.provide(
            config.metricsProtocol === "http/json"
              ? OtlpSerialization.layerJson
              : OtlpSerialization.layerProtobuf
          )
        )
  ).pipe(
    Layer.provide(FetchHttpClient.layer),
    // Exporter fibers capture services during construction; their failure
    // evidence must reach the base logger even after a remote logger closes.
    Layer.provide(baseLoggers)
  );
};
