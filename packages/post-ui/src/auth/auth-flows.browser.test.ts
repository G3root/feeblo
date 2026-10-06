import { describe, expect, it } from "vitest";

import { getSafeCallbackURL } from "./auth-flows";

/**
 * `getSafeCallbackURL` is the last thing between a `?redirectTo=` search param
 * and a `window.location.assign`, so its rejections are the security boundary,
 * not a formatting helper.
 */
describe("getSafeCallbackURL", () => {
  const appRoot = `${window.location.origin}/`;

  it("resolves a relative path on the current origin", () => {
    expect(getSafeCallbackURL("/invitation/inv_1")).toBe(
      `${window.location.origin}/invitation/inv_1`
    );
  });

  it("falls back to the app root without a value", () => {
    expect(getSafeCallbackURL()).toBe(appRoot);
  });

  it("rejects absolute destinations", () => {
    expect(getSafeCallbackURL("https://evil.example/steal")).toBe(appRoot);
  });

  it("rejects protocol-relative destinations", () => {
    expect(getSafeCallbackURL("//evil.example/steal")).toBe(appRoot);
    expect(getSafeCallbackURL("/\\evil.example/steal")).toBe(appRoot);
  });

  it("rejects a destination that only becomes external after parsing", () => {
    // The URL parser strips tabs and newlines before parsing, so this value
    // passes a leading-slash check and still resolves to another origin.
    expect(getSafeCallbackURL("/\n/evil.example/steal")).toBe(appRoot);
    expect(getSafeCallbackURL("/\t/evil.example/steal")).toBe(appRoot);
    expect(getSafeCallbackURL("/\r/evil.example/steal")).toBe(appRoot);
  });
});
