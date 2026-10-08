/**
 * OTLP telemetry configuration, parsed once at the composition root.
 *
 * The env names are the OpenTelemetry standard (`OTEL_EXPORTER_OTLP_*`), so
 * the same image points at motel locally, a self-hosted collector, or a
 * managed backend without a code change. This is a port of the config half of
 * `UsefulSoftwareCo/executor`'s `packages/telemetry`; the parts Executor
 * needs for sandboxed apps and usage accounting are deliberately omitted
 * (see `docs/telemetry.md`).
 */
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Bound each collector request, including its acknowledgement. */
export const telemetryRequestTimeout = "5 seconds" as const;

const Endpoint = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          url.username === "" &&
          url.password === ""
        );
      } catch {
        return false;
      }
    },
    { message: "Expected an HTTP telemetry endpoint without URL credentials" }
  )
);

/** One exporter target. `url` is the complete signal URL. */
export const TelemetryTarget = Schema.Struct({
  url: Endpoint,
  headers: Schema.optional(
    Schema.RedactedFromValue(Schema.Record(Schema.String, Schema.String))
  ),
});
export type TelemetryTarget = typeof TelemetryTarget.Type;

/** Shared identity and independently selectable OTLP signals. */
export const TelemetryConfig = Schema.Struct({
  service: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  environment: Schema.NonEmptyString,
  traces: Schema.optional(TelemetryTarget),
  logs: Schema.optional(TelemetryTarget),
  metrics: Schema.optional(TelemetryTarget),
  metricsProtocol: Schema.optional(
    Schema.Literals(["http/json", "http/protobuf"])
  ),
  tracesSampleRate: Schema.Finite,
});
export type TelemetryConfig = typeof TelemetryConfig.Type;

/**
 * Reads the standard OTLP environment.
 *
 * A base `OTEL_EXPORTER_OTLP_ENDPOINT` gains the `/v1/<signal>` path the
 * exporters expect; a per-signal endpoint is used verbatim. A signal with no
 * endpoint stays `undefined`, and its exporter is not built at all. Headers are
 * wrapped in `Redacted` so a backend token cannot reach a log line.
 */
export const telemetryConfig = (options: {
  readonly service: string;
  readonly environment: string;
}): Effect.Effect<TelemetryConfig, Config.ConfigError | Schema.SchemaError> =>
  Effect.gen(function* () {
    const base = yield* Config.URL("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
      Config.option
    );
    const service = yield* Config.String("OTEL_SERVICE_NAME").pipe(
      Config.withDefault(options.service)
    );
    const version = yield* Config.String("APP_RELEASE").pipe(
      Config.withDefault("dev")
    );
    const metricsProtocol = yield* Config.String(
      "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL"
    ).pipe(Config.withDefault("http/protobuf"));
    const sampleRate = yield* Config.Number(
      "FEEBLO_TELEMETRY_TRACES_SAMPLE_RATE"
    ).pipe(Config.withDefault(1));
    const target = (signal: "TRACES" | "LOGS" | "METRICS") =>
      Effect.gen(function* () {
        const endpoint = yield* Config.URL(
          `OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`
        ).pipe(Config.option);
        let url = Option.getOrUndefined(endpoint)?.href;
        if (url === undefined && Option.isSome(base)) {
          const resolved = new URL(base.value.href);
          resolved.pathname = `${resolved.pathname.replace(/\/+$/, "")}/v1/${signal.toLowerCase()}`;
          url = resolved.href;
        }
        if (url === undefined) {
          return undefined;
        }
        const headers = yield* Config.Record(
          Schema.String,
          Schema.StringFromUriComponent,
          `OTEL_EXPORTER_OTLP_${signal}_HEADERS`
        ).pipe(
          Config.orElse(() =>
            Config.Record(
              Schema.String,
              Schema.StringFromUriComponent,
              "OTEL_EXPORTER_OTLP_HEADERS"
            )
          ),
          Config.option
        );
        if (Option.isNone(headers)) {
          return { url };
        }
        return { url, headers: headers.value };
      });
    return yield* Schema.decodeUnknownEffect(TelemetryConfig)({
      service,
      version,
      environment: options.environment,
      metricsProtocol,
      // A mistyped ratio must not take down a deployment; clamp to the
      // documented 0–1 range instead.
      tracesSampleRate: Math.min(1, Math.max(0, sampleRate)),
      traces: yield* target("TRACES"),
      logs: yield* target("LOGS"),
      metrics: yield* target("METRICS"),
    });
  });
