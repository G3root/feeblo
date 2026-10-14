import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import type { TelemetryTarget } from "./config";
import { telemetryConfig } from "./config";

/** `base64("<stack-id>:<api-token>")`, with the padding Grafana Cloud emits. */
const grafanaToken =
  "MTIzNDU2NzpnbHNhX2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OQ==";

const loadTelemetryConfig = (env: Record<string, string>) =>
  telemetryConfig({ service: "feeblo-server", environment: "test" }).pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv({ env })
    )
  );

const headersOf = (target: TelemetryTarget | undefined) =>
  target?.headers === undefined ? undefined : Redacted.value(target.headers);

describe("telemetry OTLP headers", () => {
  it.effect("keeps base64 padding in a shared Authorization header", () =>
    Effect.gen(function* () {
      const config = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT:
          "https://otlp-gateway-prod-us-east-3.grafana.net/otlp",
        OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Basic ${grafanaToken}`,
      });

      // Every signal reads the shared header, padding intact: splitting on the
      // first `=` rather than every `=` is what makes this pass.
      for (const target of [config.traces, config.logs, config.metrics]) {
        expect(headersOf(target)).toEqual({
          Authorization: `Basic ${grafanaToken}`,
        });
      }
    })
  );

  it.effect("decodes URL-encoded header values", () =>
    Effect.gen(function* () {
      const config = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
        OTEL_EXPORTER_OTLP_HEADERS:
          "Authorization=Basic%20MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI6YWJjZGVm%3D%3D",
      });

      expect(headersOf(config.traces)).toEqual({
        Authorization:
          "Basic MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI6YWJjZGVm==",
      });
    })
  );

  it.effect("lets a per-signal header override the shared header", () =>
    Effect.gen(function* () {
      const config = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
        OTEL_EXPORTER_OTLP_HEADERS: "X-Shared=one",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "Authorization=Basic abc==",
      });

      expect(headersOf(config.traces)).toEqual({
        Authorization: "Basic abc==",
      });
      expect(headersOf(config.logs)).toEqual({ "X-Shared": "one" });
      expect(headersOf(config.metrics)).toEqual({ "X-Shared": "one" });
    })
  );
});

describe("telemetry resource identity and log level", () => {
  it.effect("defaults the log level to Info and accepts any case", () =>
    Effect.gen(function* () {
      const config = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      });
      const warn = yield* loadTelemetryConfig({
        FEEBLO_TELEMETRY_LOG_LEVEL: "warn",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      });
      // A telemetry knob typo must not fail startup.
      const typo = yield* loadTelemetryConfig({
        FEEBLO_TELEMETRY_LOG_LEVEL: "verbose",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      });

      expect(config.logLevel).toBe("Info");
      expect(warn.logLevel).toBe("Warn");
      expect(typo.logLevel).toBe("Info");
    })
  );

  it.effect("prefers service.instance.id over the container hostname", () =>
    Effect.gen(function* () {
      const hostname = yield* loadTelemetryConfig({
        HOSTNAME: "container-7",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      });
      const override = yield* loadTelemetryConfig({
        HOSTNAME: "container-7",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
        OTEL_RESOURCE_ATTRIBUTES: "service.instance.id=pod-9",
      });
      const none = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      });

      expect(hostname.instanceId).toBe("container-7");
      expect(override.instanceId).toBe("pod-9");
      expect(none.instanceId).toBeUndefined();
    })
  );
});

describe("telemetry OTLP endpoints", () => {
  it.effect("defaults metrics temporality to cumulative", () =>
    Effect.gen(function* () {
      const config = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      });
      const delta = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
        OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "delta",
      });

      expect(config.metricsTemporality).toBe("cumulative");
      expect(delta.metricsTemporality).toBe("delta");
    })
  );

  it.effect("appends the signal path to a base endpoint", () =>
    Effect.gen(function* () {
      const config = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      });

      expect(config.traces?.url).toBe("http://127.0.0.1:4318/v1/traces");
      expect(config.logs?.url).toBe("http://127.0.0.1:4318/v1/logs");
      expect(config.metrics?.url).toBe("http://127.0.0.1:4318/v1/metrics");
    })
  );

  it.effect("uses a per-signal endpoint verbatim", () =>
    Effect.gen(function* () {
      const config = yield* loadTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          "https://example.test/custom/traces",
      });

      expect(config.traces?.url).toBe("https://example.test/custom/traces");
      expect(config.logs?.url).toBe("http://127.0.0.1:4318/v1/logs");
    })
  );

  it.effect("builds no exporter without an endpoint", () =>
    Effect.gen(function* () {
      const config = yield* loadTelemetryConfig({});

      expect(config.traces).toBeUndefined();
      expect(config.logs).toBeUndefined();
      expect(config.metrics).toBeUndefined();
    })
  );
});
