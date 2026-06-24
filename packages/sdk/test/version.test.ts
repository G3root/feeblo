import { describe, expect, it } from "vitest";
import { organizationId } from "../src/types";
import { VERSION } from "../src/version";

describe("VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });
});

describe("organizationId", () => {
  it("returns the input string (pass-through at runtime)", () => {
    const branded = organizationId("org_abc123");
    expect(branded).toBe("org_abc123");
  });

  it("accepts the branded type where a string is expected", () => {
    const branded = organizationId("org_test");
    const label: string = branded;
    expect(label).toBe("org_test");
  });
});
