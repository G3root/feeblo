import {
  BoardQuery,
  emptyBoardQuery,
  hasActiveBoardFilters,
  normalizeBoardFilters,
  normalizeBoardQuery,
} from "@feeblo/domain-contracts/board-query";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

describe("BoardQuery", () => {
  it("round-trips the empty query through the wire schema", () => {
    const encoded = Schema.encodeSync(BoardQuery)(emptyBoardQuery);

    expect(Schema.decodeSync(BoardQuery)(encoded)).toEqual(emptyBoardQuery);
  });

  it("names the document version", () => {
    // The row is jsonb: a shape change is only safe if the reader can tell
    // which shape it is looking at. `grouping` used to be inferred from a
    // missing key; the version makes the next change explicit.
    expect(emptyBoardQuery.version).toBe(1);
  });
});

describe("normalizeBoardQuery", () => {
  it("collapses an emptied dimension to null", () => {
    const normalized = normalizeBoardQuery({
      ...emptyBoardQuery,
      filters: {
        assigneeMemberIds: [],
        search: "   ",
        status: { operator: "isAnyOf", types: [] },
        tag: { operator: "includeAllOf", tagIds: [] },
      },
    });

    expect(normalized.filters).toEqual({
      assigneeMemberIds: null,
      search: null,
      status: null,
      tag: null,
    });
  });

  it("sorts ids and status types so equal selections serialize equally", () => {
    const normalized = normalizeBoardQuery({
      ...emptyBoardQuery,
      filters: {
        assigneeMemberIds: ["mem_b", "mem_a", "mem_b"],
        search: "  billing  ",
        status: { operator: "isNot", types: ["COMPLETED", "PENDING"] },
        tag: { operator: "includeAnyOf", tagIds: ["tag_b", "tag_a"] },
      },
    });

    // Statuses follow `POST_STATUS_TYPES` (display order), ids sort
    // lexicographically, and the duplicate assignee is dropped.
    expect(normalized.filters.status).toEqual({
      operator: "isNot",
      types: ["PENDING", "COMPLETED"],
    });
    expect(normalized.filters.assigneeMemberIds).toEqual(["mem_a", "mem_b"]);
    expect(normalized.filters.tag?.tagIds).toEqual(["tag_a", "tag_b"]);
    expect(normalized.filters.search).toBe("billing");
  });

  it("is idempotent", () => {
    const once = normalizeBoardQuery({
      ...emptyBoardQuery,
      filters: {
        ...emptyBoardQuery.filters,
        status: { operator: "isAnyOf", types: ["IN_PROGRESS", "PLANNED"] },
      },
    });

    expect(normalizeBoardQuery(once)).toEqual(once);
  });
});

describe("normalizeBoardFilters", () => {
  it("leaves the search term as typed but collapses the empty string", () => {
    // The store normalizes on every keystroke; trimming there would eat the
    // space between two words. Persistence trims instead.
    expect(
      normalizeBoardFilters({
        ...emptyBoardQuery.filters,
        search: "checkout ",
      }).search
    ).toBe("checkout ");
    expect(
      normalizeBoardFilters({ ...emptyBoardQuery.filters, search: "" }).search
    ).toBeNull();
  });
});

describe("hasActiveBoardFilters", () => {
  it("is false only when every dimension is off", () => {
    expect(hasActiveBoardFilters(emptyBoardQuery.filters)).toBe(false);
    expect(
      hasActiveBoardFilters({ ...emptyBoardQuery.filters, search: "  " })
    ).toBe(false);
    expect(
      hasActiveBoardFilters({
        ...emptyBoardQuery.filters,
        status: { operator: "isAnyOf", types: ["PLANNED"] },
      })
    ).toBe(true);
    expect(
      hasActiveBoardFilters({
        ...emptyBoardQuery.filters,
        tag: { operator: "includeAllOf", tagIds: ["tag_a"] },
      })
    ).toBe(true);
    expect(
      hasActiveBoardFilters({
        ...emptyBoardQuery.filters,
        assigneeMemberIds: ["mem_a"],
      })
    ).toBe(true);
    expect(
      hasActiveBoardFilters({ ...emptyBoardQuery.filters, search: "billing" })
    ).toBe(true);
  });
});
