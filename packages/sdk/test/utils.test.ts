import { describe, expect, it } from "vitest";
import { compact, isBrowser } from "../src/utils";

describe("isBrowser", () => {
  it("returns true in a browser-like environment", () => {
    expect(isBrowser()).toBe(true);
  });
});

describe("compact", () => {
  it("strips undefined values from an object", () => {
    const input = { a: 1, b: undefined, c: "hello", d: undefined };
    const result = compact(input);

    expect(result).toEqual({ a: 1, c: "hello" });
    expect("b" in result).toBe(false);
    expect("d" in result).toBe(false);
  });

  it("returns empty object when all values are undefined", () => {
    expect(compact({ x: undefined, y: undefined })).toEqual({});
  });

  it("preserves falsy non-undefined values", () => {
    expect(compact({ a: 0, b: "", c: false, d: null })).toEqual({
      a: 0,
      b: "",
      c: false,
      d: null,
    });
  });
});
