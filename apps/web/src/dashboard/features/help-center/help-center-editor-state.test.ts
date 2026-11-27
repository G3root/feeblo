import { describe, expect, it } from "vitest";

import { isHelpCenterArticleStale } from "./help-center-editor-state";

/**
 * The editor stops writing when the row it loaded has moved. The comparison is
 * the whole rule, so the cases worth pinning are the two that must stay
 * writable (a fresh create, and the row the editor itself loaded) and the two
 * that must not (a refreshed timestamp, in either direction).
 */
describe("isHelpCenterArticleStale", () => {
  const opened = new Date("2026-01-02T03:04:05.000Z");

  it("treats a create with no loaded row as in sync", () => {
    expect(isHelpCenterArticleStale(undefined, undefined)).toBe(false);
  });

  it("treats the loaded row as in sync", () => {
    expect(isHelpCenterArticleStale(opened, new Date(opened))).toBe(false);
  });

  it("reports stale when the read refreshed the row", () => {
    expect(
      isHelpCenterArticleStale(opened, new Date("2026-01-02T03:04:06.000Z"))
    ).toBe(true);
  });

  it("reports stale when the refreshed row is older", () => {
    expect(
      isHelpCenterArticleStale(opened, new Date("2026-01-02T03:04:04.000Z"))
    ).toBe(true);
  });

  it("does not report stale when the current row is missing", () => {
    expect(isHelpCenterArticleStale(opened, undefined)).toBe(false);
  });
});
