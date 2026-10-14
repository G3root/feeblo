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
import * as References from "effect/References";
import * as Tracer from "effect/Tracer";

import type { TelemetryConfig, TelemetryTarget } from "./config";
import { rpcSpans } from "./rpc-spans";
import { allowedSpans, rootSpanNoise } from "./span-attributes";

/** Nothing is skipped when the root-span filter is turned off for debugging. */
const noRootSpans: ReadonlySet<string> = new Set();

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
    /** Prefix `@feeblo/domain/rpc-router` gives every RPC server span. */
    readonly rpcSpanPrefix?: string | undefined;
  }
) => {
  const lifetime = options?.lifetime ?? "process";
  const rpcSpanPrefix = options?.rpcSpanPrefix ?? "RpcServer";
  const baseLoggers =
    options?.baseLoggers ??
    Logger.layer([defaultTelemetryLogger], { mergeWithExisting: false });
  const environmentAttributes = {
    // `deployment.environment` is the pre-1.27 semantic-convention name;
    // Grafana's Application Observability still filters on it by default.
    // Send both it and the stable rename so either reader matches.
    "deployment.environment": config.environment,
    "deployment.environment.name": config.environment,
  };
  const resource = {
    serviceName: config.service,
    serviceVersion: config.version,
    // `service.instance.id` is per-process identity: Grafana maps it to the
    // `instance` label on metrics and logs, so replicas stay distinguishable.
    attributes:
      config.instanceId === undefined
        ? environmentAttributes
        : {
            ...environmentAttributes,
            "service.instance.id": config.instanceId,
          },
  };
  const signal = (
    target: TelemetryTarget,
    processExportInterval: "1 second" | "5 seconds" | "30 seconds"
  ) => {
    const common = {
      url: target.url,
      resource,
      exportInterval:
        lifetime === "event" ? ("1 hour" as const) : processExportInterval,
      shutdownTimeout: "3 seconds" as const,
    };
    return target.headers === undefined
      ? common
      : { ...common, headers: Redacted.value(target.headers) };
  };
  return Layer.mergeAll(
    config.traces === undefined
      ? Layer.empty
      : OtlpTracer.layer(
          // Effect's own default; the one-second interval this was ported
          // with is for short-lived processes, and a server gains nothing
          // from it.
          signal(config.traces, "5 seconds")
        ).pipe(
          Layer.provide(OtlpSerialization.layerJson),
          Layer.provide(FetchHttpClient.layer),
          // Wrap the exporter's tracer with RPC labelling, the attribute
          // filter, and ratio sampling. `flatMap` replaces the layer output
          // with a value, so the `Tracer.Tracer` reference is provided without
          // appearing in the declared output — which is what lets consumers
          // stop requiring it.
          Layer.flatMap((context) =>
            Layer.succeed(
              Tracer.Tracer,
              allowedSpans(
                rpcSpans(Context.get(context, Tracer.Tracer), {
                  spanPrefix: rpcSpanPrefix,
                }),
                {
                  sampleRate: config.tracesSampleRate,
                  dropRootSpans: config.dropRootSpans
                    ? rootSpanNoise
                    : noRootSpans,
                }
              )
            )
          )
        ),
    config.logs === undefined
      ? baseLoggers
      : OtlpLogger.layer({
          ...signal(config.logs, "1 second"),
          mergeWithExisting: true,
        }).pipe(
          Layer.provide(OtlpSerialization.layerJson),
          Layer.provideMerge(baseLoggers)
        ),
    config.metrics === undefined
      ? Layer.empty
      : OtlpMetrics.layer({
          ...signal(config.metrics, "30 seconds"),
          // Cumulative is what Prometheus-based backends (Grafana Cloud,
          // Mimir, self-hosted Prometheus) store and query; delta is for
          // backends that require it, such as Datadog. Mimir's delta OTLP
          // ingest is still incomplete, so cumulative is the default.
          temporality: config.metricsTemporality,
        }).pipe(
          Layer.provide(
            config.metricsProtocol === "http/json"
              ? OtlpSerialization.layerJson
              : OtlpSerialization.layerProtobuf
          )
        ),
    // Bound log volume without a redeploy: Effect's default is `Info`, and
    // raising it to `Warn` is the escalation lever during an incident.
    Layer.succeed(References.MinimumLogLevel, config.logLevel)
  ).pipe(
    Layer.provide(FetchHttpClient.layer),
    // Exporter fibers capture services during construction; their failure
    // evidence must reach the base logger even after a remote logger closes.
    Layer.provide(baseLoggers)
  );
};
