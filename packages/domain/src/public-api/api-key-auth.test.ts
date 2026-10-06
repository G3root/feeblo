import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";

import { publicApiRateLimitHeaders } from "./api-key-auth";

/**
 * Direct tests for the published rate-limit headers.
 *
 * Both surfaces send the headers from this one function: the budget state
 * comes from the limiter, and the reset is computed from a clock reading taken
 * when the response is built, so the same `resetAfter` maps to a later instant
 * as a request sits in flight. The mapping is arithmetic a live suite would
 * only reach after spending a real budget, so it is pinned here.
 */

describe("public api rate-limit headers", () => {
  it("publishes the budget and an absolute reset instant", () => {
    const headers = publicApiRateLimitHeaders(
      { limit: 300, remaining: 42, resetAfter: Duration.seconds(30) },
      1_700_000_000_000
    );

    expect(headers["x-ratelimit-limit"]).toBe("300");
    expect(headers["x-ratelimit-remaining"]).toBe("42");
    expect(headers["x-ratelimit-reset"]).toBe("1700000030");
  });

  it("floors a sub-second remainder to the second it lands in", () => {
    const headers = publicApiRateLimitHeaders(
      { limit: 1, remaining: 0, resetAfter: Duration.millis(1_500) },
      1_700_000_000_000
    );

    expect(headers["x-ratelimit-reset"]).toBe("1700000001");
  });

  it("reports a spent window as resetting now when no remainder is left", () => {
    const headers = publicApiRateLimitHeaders(
      { limit: 1, remaining: 0, resetAfter: Duration.zero },
      1_700_000_000_999
    );

    expect(headers["x-ratelimit-reset"]).toBe("1700000000");
  });
});
