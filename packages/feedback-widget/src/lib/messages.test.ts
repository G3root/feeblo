import { describe, expect, it } from "vitest";

import { isParentMessage } from "./messages";

/** Values the parent frame may post, including malformed shapes the guard must reject. */
type PostedValue =
  | { event?: unknown; data?: unknown }
  | null
  | undefined
  | number
  | string
  | boolean;

/** Plain-boolean wrapper so the type-guard narrowing does not affect assertions. */
function accepts(value: PostedValue): boolean {
  return isParentMessage(value);
}

describe("isParentMessage", () => {
  it("rejects values that are not an object or have no event", () => {
    expect(accepts(null)).toBe(false);
    expect(accepts(undefined)).toBe(false);
    expect(accepts(42)).toBe(false);
    expect(accepts("SHOW")).toBe(false);
    expect(accepts("IDENTIFY")).toBe(false);
    expect(accepts("")).toBe(false);
    expect(accepts({})).toBe(false);
    expect(accepts({ data: {} })).toBe(false);
  });

  it("rejects unknown or non-string events", () => {
    expect(accepts({ event: "UNKNOWN" })).toBe(false);
    expect(accepts({ event: "identify" })).toBe(false);
    expect(accepts({ event: 42 })).toBe(false);
    expect(accepts({ event: null })).toBe(false);
  });

  describe("IDENTIFY — identity/clear protocol", () => {
    it("accepts a non-empty string id as an identity", () => {
      expect(
        accepts({
          event: "IDENTIFY",
          data: { id: "u_1", name: "Ada", email: "ada@example.com" },
        })
      ).toBe(true);
    });

    it("accepts exactly an empty-string id as the logout clear signal", () => {
      expect(accepts({ event: "IDENTIFY", data: { id: "" } })).toBe(true);
    });

    it("rejects a missing id — it must not be treated as a clear", () => {
      expect(accepts({ event: "IDENTIFY", data: {} })).toBe(false);
    });

    it("rejects a null id", () => {
      expect(accepts({ event: "IDENTIFY", data: { id: null } })).toBe(false);
    });

    it("rejects a numeric id", () => {
      expect(accepts({ event: "IDENTIFY", data: { id: 123 } })).toBe(false);
    });

    it("rejects a boolean id", () => {
      expect(accepts({ event: "IDENTIFY", data: { id: true } })).toBe(false);
    });

    it("rejects an object id", () => {
      expect(
        accepts({
          event: "IDENTIFY",
          data: { id: { toString: () => "x" } },
        })
      ).toBe(false);
    });

    it("rejects non-object data", () => {
      expect(accepts({ event: "IDENTIFY", data: null })).toBe(false);
      expect(accepts({ event: "IDENTIFY", data: "u_1" })).toBe(false);
      expect(accepts({ event: "IDENTIFY", data: 42 })).toBe(false);
    });

    it("rejects array data", () => {
      expect(accepts({ event: "IDENTIFY", data: [1, 2] })).toBe(false);
    });

    it("rejects a missing data shape entirely", () => {
      expect(accepts({ event: "IDENTIFY" })).toBe(false);
    });
  });

  describe("other parent events — regression guard", () => {
    it("accepts SHOW and HIDE without data", () => {
      expect(accepts({ event: "SHOW" })).toBe(true);
      expect(accepts({ event: "HIDE" })).toBe(true);
    });

    it("accepts SET_CONTEXT only when every value is a string", () => {
      expect(
        accepts({ event: "SET_CONTEXT", data: { page: "/pricing" } })
      ).toBe(true);
      expect(accepts({ event: "SET_CONTEXT", data: {} })).toBe(true);
      expect(
        accepts({ event: "SET_CONTEXT", data: { page: 42 } })
      ).toBe(false);
    });

    it("accepts SET_MODULE only for enabled modules", () => {
      expect(
        accepts({ event: "SET_MODULE", data: { module: "feedback" } })
      ).toBe(true);
      expect(
        accepts({ event: "SET_MODULE", data: { module: "updates" } })
      ).toBe(true);
      expect(
        accepts({ event: "SET_MODULE", data: { module: "roadmap" } })
      ).toBe(false);
    });

    it("accepts SET_BOARD only with a non-empty board id", () => {
      expect(
        accepts({ event: "SET_BOARD", data: { board: "bugs" } })
      ).toBe(true);
      expect(accepts({ event: "SET_BOARD", data: { board: "" } })).toBe(false);
    });

    it("accepts SET_LOCALE only for supported locales", () => {
      expect(
        accepts({ event: "SET_LOCALE", data: { locale: "en" } })
      ).toBe(true);
      expect(
        accepts({ event: "SET_LOCALE", data: { locale: "fr" } })
      ).toBe(false);
    });
  });
});
