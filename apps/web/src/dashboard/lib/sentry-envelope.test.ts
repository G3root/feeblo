import { describe, expect, it } from "vitest";

import { envelopeTarget, maxEnvelopeBytes } from "./sentry-envelope";

const dsn = "https://public@o123.ingest.sentry.io/456";
const envelope = (body: string, value = dsn) =>
  `${JSON.stringify({ dsn: value })}\n${body}`;

/**
 * The tunnel is a blind relay to a public DSN. These cases pin the two
 * properties that make that safe: the destination always comes from the
 * configured DSN, and an envelope for another project is refused.
 */
describe("envelopeTarget", () => {
  it("derives the ingestion URL from the configured DSN", () => {
    expect(envelopeTarget(envelope('{"event_id":"abc"}'), dsn)).toBe(
      "https://o123.ingest.sentry.io/api/456/envelope/?sentry_version=7&sentry_key=public"
    );
  });

  it("refuses an envelope addressed to another project", () => {
    const other = "https://public@o999.ingest.sentry.io/999";
    expect(envelopeTarget(envelope("{}", other), dsn)).toBeUndefined();
  });

  it("refuses a body without an envelope header", () => {
    expect(envelopeTarget('{"dsn":', dsn)).toBeUndefined();
  });

  it("refuses a non-HTTPS DSN", () => {
    expect(
      envelopeTarget(envelope("{}", "http://public@o1.ingest.sentry.io/2"), dsn)
    ).toBeUndefined();
    expect(
      envelopeTarget(
        envelope("{}", "http://localhost:9000/1"),
        "http://localhost:9000/1"
      )
    ).toBeUndefined();
  });

  it("refuses a DSN with a non-numeric project path", () => {
    expect(
      envelopeTarget(
        envelope("{}", "https://public@o1.ingest.sentry.io/project"),
        dsn
      )
    ).toBeUndefined();
  });

  it("keeps the ceiling small enough for a relay", () => {
    expect(maxEnvelopeBytes).toBeLessThanOrEqual(1024 * 1024);
  });
});
