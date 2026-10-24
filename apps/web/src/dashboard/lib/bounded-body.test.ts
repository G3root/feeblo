import { describe, expect, it } from "vitest";

import { readBoundedText } from "./bounded-body";

const request = (body: string) =>
  new Request("http://localhost/", { method: "POST", body });

/**
 * The relays read an unauthenticated body, so the limit has to hold during the
 * read, not after it. These cases pin that the reader stops at the limit and
 * still returns a normal body intact.
 */
describe("readBoundedText", () => {
  it("returns a body that fits", async () => {
    await expect(readBoundedText(request("hello"), 10)).resolves.toBe("hello");
  });

  it("returns the body at exactly the limit", async () => {
    await expect(readBoundedText(request("hello"), 5)).resolves.toBe("hello");
  });

  it("refuses a body past the limit", async () => {
    await expect(
      readBoundedText(request("hello!"), 5)
    ).resolves.toBeUndefined();
  });

  it("returns an empty string when there is no body", async () => {
    await expect(
      readBoundedText(new Request("http://localhost/"), 5)
    ).resolves.toBe("");
  });
});
