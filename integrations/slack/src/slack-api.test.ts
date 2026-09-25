import { describe, expect, it } from "@effect/vitest";

import { classifySlackApiError, slackErrorResponse } from "./slack-api";

/**
 * `classifySlackApiError` is the single place a Slack failure becomes a typed
 * provider failure, and the retry worker branches on which one it is.
 *
 * The tests go through `slackErrorResponse` rather than hand-building the
 * classifier's argument, because that is the seam that broke: the classifier
 * decodes its input against `SlackApiErrorEnvelope`, which requires `ok: false`
 * and a string `error`, and an input missing either field silently demotes an
 * auth or channel problem to a permanent rejection. Testing the classifier with
 * a pre-built argument cannot catch that.
 */
describe("classifySlackApiError", () => {
  it("treats 401 and 403 as authentication failures from the status alone", () => {
    for (const status of [401, 403]) {
      const failure = classifySlackApiError({ status }, "chat.postMessage");
      expect(failure._tag).toBe("IntegrationProviderAuthenticationError");
    }
  });

  it("reads retry_after off a rate-limited envelope", () => {
    const failure = classifySlackApiError(
      slackErrorResponse(
        {
          ok: false,
          error: "ratelimited",
          response_metadata: { retry_after: 30 },
        },
        429
      ),
      "chat.postMessage"
    );

    expect(failure._tag).toBe("IntegrationProviderRateLimitedError");
    expect(failure).toMatchObject({ retryAfterMs: 30_000 });
  });

  it("reports a rate limit without retry_after rather than dropping the failure", () => {
    const failure = classifySlackApiError(
      slackErrorResponse({ ok: false, error: "ratelimited" }, 429),
      "chat.postMessage"
    );

    expect(failure._tag).toBe("IntegrationProviderRateLimitedError");
    expect(failure).not.toHaveProperty("retryAfterMs");
  });

  it("treats 5xx as a temporary failure", () => {
    const failure = classifySlackApiError({ status: 503 }, "chat.postMessage");
    expect(failure._tag).toBe("IntegrationProviderTemporaryFailure");
  });

  it("maps invalid_auth and account_inactive to authentication failures", () => {
    for (const error of ["invalid_auth", "account_inactive"]) {
      const failure = classifySlackApiError(
        slackErrorResponse({ ok: false, error }, 200),
        "chat.postMessage"
      );
      expect(failure._tag).toBe("IntegrationProviderAuthenticationError");
    }
  });

  it("maps channel errors to invalid configuration failures", () => {
    for (const error of [
      "not_in_channel",
      "channel_not_found",
      "is_archived",
      "invalid_channel",
      "unknown_channel",
    ]) {
      const failure = classifySlackApiError(
        slackErrorResponse({ ok: false, error }, 200),
        "chat.postMessage"
      );
      expect(failure._tag).toBe("IntegrationProviderInvalidConfigurationError");
    }
  });

  it("maps missing_scope to an invalid configuration failure", () => {
    const failure = classifySlackApiError(
      slackErrorResponse({ ok: false, error: "missing_scope" }, 200),
      "chat.postMessage"
    );

    expect(failure._tag).toBe("IntegrationProviderInvalidConfigurationError");
  });

  it("names the unrecognised error code in a permanent rejection", () => {
    const failure = classifySlackApiError(
      slackErrorResponse({ ok: false, error: "some_new_error" }, 200),
      "chat.postMessage"
    );

    expect(failure._tag).toBe("IntegrationProviderPermanentRejection");
    expect(failure.message).toContain("some_new_error");
  });

  it("falls back to a permanent rejection when the body is not an error envelope", () => {
    for (const body of [
      {},
      { ok: true },
      { error: 42 },
      [],
      "not-an-object",
      null,
    ]) {
      const failure = classifySlackApiError(
        slackErrorResponse(body, 200),
        "chat.postMessage"
      );
      expect(failure._tag).toBe("IntegrationProviderPermanentRejection");
    }
  });

  it("never puts the response body in the failure message", () => {
    const failure = classifySlackApiError(
      slackErrorResponse(
        { ok: false, error: "invalid_auth", secret: "xoxb-should-not-appear" },
        200
      ),
      "chat.postMessage"
    );

    expect(JSON.stringify(failure)).not.toContain("xoxb-should-not-appear");
  });
});

describe("slackErrorResponse", () => {
  it("keeps the fields the classifier decodes against", () => {
    expect(
      slackErrorResponse({ ok: false, error: "invalid_auth" }, 200)
    ).toEqual({ ok: false, error: "invalid_auth", status: 200 });
  });

  it("drops fields the classifier does not read", () => {
    expect(
      slackErrorResponse({ ok: false, error: "x", secret: "nope" }, 200)
    ).not.toHaveProperty("secret");
  });

  it("yields nothing to decode for a body that is not a plain object", () => {
    for (const body of [[1, 2], "ab", 7, true, null]) {
      expect(slackErrorResponse(body, 429)).toEqual({ status: 429 });
    }
  });
});
