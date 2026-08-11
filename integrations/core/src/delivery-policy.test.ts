import { describe, expect, it } from "vitest";
import {
  classifyIntegrationHttpDeliveryStatus,
  computeIntegrationRetryDelayMs,
  decideIntegrationDeliveryRetry,
  maxIntegrationDeliveryAttempts,
} from "./delivery-policy";

describe("integration delivery retry policy", () => {
  it("treats every 2xx response as a successful delivery", () => {
    expect(classifyIntegrationHttpDeliveryStatus(204)).toEqual({
      _tag: "Succeeded",
    });
  });

  it("retries transport-equivalent retryable HTTP statuses and terminals other 4xx", () => {
    expect(classifyIntegrationHttpDeliveryStatus(429)).toEqual({
      _tag: "Retry",
    });
    expect(classifyIntegrationHttpDeliveryStatus(422)).toEqual({
      _tag: "Terminal",
    });
  });

  it("uses the stated schedule, bounded jitter, and a valid Retry-After floor", () => {
    expect(
      computeIntegrationRetryDelayMs({
        attemptCount: 1,
        jitterRatio: 0,
      })
    ).toBe(60_000);
    expect(
      computeIntegrationRetryDelayMs({
        attemptCount: 1,
        jitterRatio: -1,
      })
    ).toBe(48_000);
    expect(
      computeIntegrationRetryDelayMs({
        attemptCount: 1,
        jitterRatio: 0,
        retryAfterMs: 120_000,
      })
    ).toBe(120_000);
  });

  it("exhausts only after the immediate attempt and every scheduled retry", () => {
    expect(
      decideIntegrationDeliveryRetry({
        attemptCount: maxIntegrationDeliveryAttempts,
        jitterRatio: 0,
        outcome: { _tag: "Retry" },
      })
    ).toEqual({ _tag: "Exhausted" });
  });
});
