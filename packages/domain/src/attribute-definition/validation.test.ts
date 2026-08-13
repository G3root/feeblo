import { describe, expect, it } from "vitest";

import { isPotentiallyUnsafeRegex } from "./validation";

describe("isPotentiallyUnsafeRegex", () => {
  it("rejects quantified ambiguous alternatives", () => {
    expect(isPotentiallyUnsafeRegex("^(a|aa)+$")).toBe(true);
  });

  it("allows a bounded attribute pattern", () => {
    expect(isPotentiallyUnsafeRegex("^[A-Z]{3}$")).toBe(false);
  });
});
