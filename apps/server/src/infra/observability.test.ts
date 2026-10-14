import { expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";

import { failureSummary } from "./observability";

const summaryOf = (message: string): string =>
  failureSummary(Cause.fail(new Error(message)));

it("keeps the error tag in the summary", () => {
  const error = new Config.ConfigError(
    new ConfigProvider.SourceError({
      message: "OTEL_EXPORTER_OTLP_HEADERS is invalid",
    })
  );
  const summary = failureSummary(Cause.fail(error));

  expect(summary).toContain("ConfigError");
  expect(summary).toContain("OTEL_EXPORTER_OTLP_HEADERS is invalid");
});

it("redacts bearer tokens quoted back by a config error", () => {
  const token = "glsa_0123456789abcdefghijklmnopqrstuv";
  const summary = summaryOf(
    `OTEL_EXPORTER_OTLP_HEADERS is invalid: Authorization=Bearer ${token}`
  );

  expect(summary).not.toContain(token);
  expect(summary).toContain("Authorization=[redacted]");
});

it("redacts basic credentials quoted back by a config error", () => {
  const token = "MTIzNDU2NzpnbHNhX2FiY2RlZmdoaWprbG1ub3BxcnN0dXY=";
  const summary = summaryOf(
    `OTEL_EXPORTER_OTLP_HEADERS is invalid: Authorization=Basic ${token}`
  );

  expect(summary).not.toContain(token);
  expect(summary).toContain("Authorization=[redacted]");
});

it("redacts credentials inside a JSON-quoted header record", () => {
  const token = "glsa_0123456789abcdefghijklmnopqrstuv";
  const summary = summaryOf(
    `Expected a record, got {"Authorization":"Bearer ${token}"}`
  );

  expect(summary).not.toContain(token);
  expect(summary).toContain("[redacted]");
});

it("redacts URL credentials and secret query values", () => {
  const password = "supersecret";
  const apiKey = "abcdef0123456789";
  const summary = summaryOf(
    `Expected an endpoint: https://collector:${password}@otlp.test/v1/traces?api_key=${apiKey}`
  );

  expect(summary).not.toContain(password);
  expect(summary).not.toContain(apiKey);
  expect(summary).toContain("[redacted]");
});

it("collapses schema issue formatting to one line", () => {
  const summary = summaryOf(
    'Expected an HTTP telemetry endpoint without URL credentials\n  at ["traces"]["url"]'
  );

  expect(summary).not.toContain("\n");
  expect(summary).toContain('at ["traces"]["url"]');
});

it("caps the summary so one broken value cannot flood the log", () => {
  const summary = summaryOf("x".repeat(2_000));

  expect(summary.length).toBeLessThanOrEqual(500);
  expect(summary.endsWith("…")).toBe(true);
});

it("keeps every failure message in the summary", () => {
  const summary = failureSummary(
    Cause.combine(
      Cause.fail(new Error("first failure")),
      Cause.fail(new Error("second failure"))
    )
  );

  expect(summary).toContain("first failure");
  expect(summary).toContain("second failure");
});
