import { describe, expect, it } from "@effect/vitest";

import {
  HELP_CENTER_SEARCH_MAX_QUERY_LENGTH,
  HELP_CENTER_SEARCH_MAX_TERMS,
  helpCenterSearchTerms,
  helpCenterSearchTsQuery,
  normalizeHelpCenterSearchQuery,
} from "./search";

describe("normalizeHelpCenterSearchQuery", () => {
  it("folds case and spacing into one form", () => {
    expect(normalizeHelpCenterSearchQuery("  Export   CSV ")).toBe(
      "export csv"
    );
  });

  it("bounds the stored query to what the box accepts", () => {
    const normalized = normalizeHelpCenterSearchQuery("a".repeat(500));

    expect(normalized).toHaveLength(HELP_CENTER_SEARCH_MAX_QUERY_LENGTH);
  });
});

describe("helpCenterSearchTerms", () => {
  it("drops single characters and duplicates", () => {
    expect(helpCenterSearchTerms("I can export export a board")).toStrictEqual([
      "can",
      "export",
      "board",
    ]);
  });

  it("keeps only letters and digits, so nothing reaches the tsquery parser", () => {
    // Every one of these characters is `to_tsquery` syntax.
    expect(helpCenterSearchTerms("a&b|c!d(e)f:g'h")).toStrictEqual([]);
    expect(helpCenterSearchTerms("export & import")).toStrictEqual([
      "export",
      "import",
    ]);
  });

  it("bounds the number of terms", () => {
    const terms = helpCenterSearchTerms(
      Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ")
    );

    expect(terms).toHaveLength(HELP_CENTER_SEARCH_MAX_TERMS);
  });
});

describe("helpCenterSearchTsQuery", () => {
  it("ORs prefix branches", () => {
    expect(helpCenterSearchTsQuery(["export", "csv"])).toBe("export:* | csv:*");
  });

  it("answers null when there is nothing to match on", () => {
    expect(helpCenterSearchTsQuery([])).toBeNull();
    expect(helpCenterSearchTsQuery(helpCenterSearchTerms("!!!"))).toBeNull();
  });
});
