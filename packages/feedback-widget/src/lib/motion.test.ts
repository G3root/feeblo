import { describe, expect, it } from "vitest";

import { consumeSurfaceEntry } from "./motion";

describe("surface entry consumption", () => {
  it("consumes each module once per widget document", () => {
    expect(consumeSurfaceEntry("feedback")).toBe(true);
    expect(consumeSurfaceEntry("feedback")).toBe(false);
    expect(consumeSurfaceEntry("updates")).toBe(true);
    expect(consumeSurfaceEntry("updates")).toBe(false);
  });
});
