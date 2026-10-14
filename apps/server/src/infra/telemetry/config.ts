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
import * as SchemaGetter from "effect/SchemaGetter";

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

/** The log levels `FEEBLO_TELEMETRY_LOG_LEVEL` accepts, in effect's spelling. */
const logLevelSchema = Schema.Literals([
  "All",
  "Fatal",
  "Error",
  "Warn",
  "Info",
  "Debug",
  "Trace",
  "None",
]);

type LogLevelName = typeof logLevelSchema.Type;

/**
 * `FEEBLO_TELEMETRY_LOG_LEVEL` is case-insensitive; an unknown value keeps the
 * `Info` default rather than failing startup over a telemetry knob. The lookup
 * is derived from the schema so the accepted names live in exactly one place.
 */
const logLevels: ReadonlyMap<string, LogLevelName> = new Map(
  logLevelSchema.literals.map((level) => [level.toLowerCase(), level])
);

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
  metricsTemporality: Schema.Literals(["cumulative", "delta"]),
  logLevel: logLevelSchema,
  /**
   * `service.instance.id`, from `OTEL_RESOURCE_ATTRIBUTES` when the operator
   * sets it, otherwise the container hostname.
   */
  instanceId: Schema.optional(Schema.NonEmptyString),
  tracesSampleRate: Schema.Finite,
  /** Whether parentless `sql.*` spans are kept; false is a debugging escape hatch. */
  dropRootSpans: Schema.Boolean,
});
export type TelemetryConfig = typeof TelemetryConfig.Type;

/**
 * Header values may contain `=` — Grafana Cloud's `Authorization=Basic
 * <base64>` does whenever the base64 carries padding — and the separated-string
 * parser behind `Config.Record` splits each pair on every `=`, silently
 * truncating the value. Split on the first `=` instead, as the OTLP spec and
 * the official SDKs do, and let `StringFromUriComponent` own the URL decoding
 * so a malformed escape still fails loudly.
 */
const headerRecord = Schema.Record(
  Schema.String,
  Schema.StringFromUriComponent
);

const splitHeaders = SchemaGetter.transform((input: string) => {
  const headers = new Map<string, string>();
  for (const pair of input.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    headers.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return Object.fromEntries(headers);
});

const OtlpHeaders = Schema.Union([
  headerRecord,
  Schema.String.pipe(
    Schema.decodeTo(Schema.toCodecStringTree(headerRecord), {
      decode: splitHeaders,
      encode: SchemaGetter.compose(
        SchemaGetter.passthrough<Record<string, string>, Schema.StringTree>({
          strict: false,
        }),
        SchemaGetter.transform((headers: Record<string, string>) =>
          Object.entries(headers)
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join(",")
        )
      ),
    })
  ),
]);

const otlpHeaders = (path: string) => Config.schema(OtlpHeaders, path);

/** An env value that is set but empty means "not set", not an empty identity. */
const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

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
    const metricsTemporality = yield* Config.String(
      "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE"
    ).pipe(Config.withDefault("cumulative"));
    const sampleRate = yield* Config.Number(
      "FEEBLO_TELEMETRY_TRACES_SAMPLE_RATE"
    ).pipe(Config.withDefault(1));
    const dropRootSpans = yield* Config.Boolean(
      "FEEBLO_TELEMETRY_DROP_ROOT_SPANS"
    ).pipe(Config.withDefault(true));
    const logLevel = yield* Config.String("FEEBLO_TELEMETRY_LOG_LEVEL").pipe(
      Config.withDefault("Info")
    );
    const resourceAttributes: Record<string, string> = yield* Config.Record(
      Schema.String,
      Schema.StringFromUriComponent,
      "OTEL_RESOURCE_ATTRIBUTES"
    ).pipe(Config.withDefault({}));
    const hostname = yield* Config.NonEmptyString("HOSTNAME").pipe(
      Config.option
    );
    const instanceId =
      nonEmpty(resourceAttributes["service.instance.id"]) ??
      Option.getOrUndefined(hostname);
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
        const headers = yield* otlpHeaders(
          `OTEL_EXPORTER_OTLP_${signal}_HEADERS`
        ).pipe(
          Config.orElse(() => otlpHeaders("OTEL_EXPORTER_OTLP_HEADERS")),
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
      metricsTemporality,
      logLevel: logLevels.get(logLevel.toLowerCase()) ?? "Info",
      instanceId,
      // A mistyped ratio must not take down a deployment; clamp to the
      // documented 0–1 range instead.
      tracesSampleRate: Math.min(1, Math.max(0, sampleRate)),
      dropRootSpans,
      traces: yield* target("TRACES"),
      logs: yield* target("LOGS"),
      metrics: yield* target("METRICS"),
    });
  });
