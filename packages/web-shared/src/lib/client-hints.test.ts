import { describe, expect, it } from "vitest";
import {
  defaultTimeZone,
  getClientHintCheckScript,
  getHints,
  timeZoneHintCookieName,
} from "./client-hints";

const requestWithCookie = (value?: string) =>
  new Request("https://app.feeblo.com", {
    headers: value
      ? { cookie: `${timeZoneHintCookieName}=${encodeURIComponent(value)}` }
      : undefined,
  });

describe("timezone client hint", () => {
  it("uses the account default until the browser hint is available", () => {
    expect(getHints(requestWithCookie()).timeZone).toBe(defaultTimeZone);
  });

  it("reads a valid IANA timezone from the hint cookie", () => {
    expect(getHints(requestWithCookie("Asia/Colombo")).timeZone).toBe(
      "Asia/Colombo"
    );
  });

  it("falls back when a forged or malformed hint is supplied", () => {
    expect(getHints(requestWithCookie("not-a-timezone")).timeZone).toBe(
      defaultTimeZone
    );
  });

  it("emits the pre-paint cookie check", () => {
    const script = getClientHintCheckScript();
    expect(script).toContain(timeZoneHintCookieName);
    expect(script).toContain(
      "Intl.DateTimeFormat().resolvedOptions().timeZone"
    );
  });
});
