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

  it("retries every transport-equivalent retryable status and terminals other statuses", () => {
    for (const status of [408, 409, 425, 429, 500, 502, 503, 504, 599]) {
      expect(classifyIntegrationHttpDeliveryStatus(status)).toEqual({
        _tag: "Retry",
      });
    }
    for (const status of [301, 302, 400, 401, 403, 404, 422]) {
      expect(classifyIntegrationHttpDeliveryStatus(status)).toEqual({
        _tag: "Terminal",
      });
    }
  });

  it("carries a bounded Retry-After into the retry outcome", () => {
    expect(classifyIntegrationHttpDeliveryStatus(429, 120_000)).toEqual({
      _tag: "Retry",
      retryAfterMs: 120_000,
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
