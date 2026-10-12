import { describe, expect, it } from "vitest";

import { reviewSearchSchema } from "./search";

describe("reviewSearchSchema", () => {
  it("falls back to no filter when a link carries an invalid value", () => {
    const parsed = reviewSearchSchema.parse({
      board: "",
      filter: "bogus",
      message: "",
    });

    expect(parsed.filter).toBeUndefined();
    expect(parsed.board).toBeUndefined();
    expect(parsed.message).toBeUndefined();
  });

  it("keeps a well-formed view", () => {
    const parsed = reviewSearchSchema.parse({
      board: "Feedback",
      filter: "warned",
      message: "The title is required.",
      page: "2",
      size: "250",
      sort: "row_desc",
    });

    expect(parsed).toMatchObject({
      board: "Feedback",
      filter: "warned",
      message: "The title is required.",
      page: 2,
      size: 250,
      sort: "row_desc",
    });
  });

  it("falls back on a malformed window", () => {
    const parsed = reviewSearchSchema.parse({
      page: "-1",
      size: "10",
      sort: "sideways",
    });

    expect(parsed.page).toBeUndefined();
    expect(parsed.size).toBeUndefined();
    expect(parsed.sort).toBeUndefined();
  });
});
