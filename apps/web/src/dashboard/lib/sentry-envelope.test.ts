import { describe, expect, it } from "vitest";

import {
  envelopeTarget,
  isEnvelopeContentType,
  maxEnvelopeBytes,
} from "./sentry-envelope";

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

  it("refuses a header that is not a JSON object", () => {
    expect(envelopeTarget("null\n{}", dsn)).toBeUndefined();
    expect(envelopeTarget("[]\n{}", dsn)).toBeUndefined();
    expect(envelopeTarget('"dsn"\n{}', dsn)).toBeUndefined();
    expect(envelopeTarget("42\n{}", dsn)).toBeUndefined();
  });

  it("refuses an object header without a string DSN", () => {
    expect(envelopeTarget('{"dsn":null}\n{}', dsn)).toBeUndefined();
    expect(envelopeTarget('{"dsn":123}\n{}', dsn)).toBeUndefined();
    expect(envelopeTarget('{"event_id":"abc"}\n{}', dsn)).toBeUndefined();
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

/**
 * The browser SDK's fetch transport sends no Content-Type. A tunnel that
 * requires one silently drops every browser event, so these cases pin the
 * accepted spellings and the rejection of an unrelated type.
 */
describe("isEnvelopeContentType", () => {
  it("accepts the documented envelope type", () => {
    expect(isEnvelopeContentType("application/x-sentry-envelope")).toBe(true);
  });

  it("accepts a plain-text proxy body, with or without parameters", () => {
    expect(isEnvelopeContentType("text/plain")).toBe(true);
    expect(isEnvelopeContentType("text/plain;charset=UTF-8")).toBe(true);
  });

  it("accepts a missing header, which is what the browser transport sends", () => {
    expect(isEnvelopeContentType(null)).toBe(true);
  });

  it("rejects any other content type", () => {
    expect(isEnvelopeContentType("application/json")).toBe(false);
    expect(isEnvelopeContentType("multipart/form-data")).toBe(false);
  });
});
