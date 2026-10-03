import { describe, expect, it } from "@effect/vitest";

import { evaluateNotifiedBoardVisibility } from "./access";

/**
 * The send-time gate's board proof for one delivery.
 *
 * `captured` is what the rendered email was proven to name; `current` is what
 * the notified posts resolve to now. Either can deny the global-user rule, and
 * the snapshot is what closes the gap when a post is deleted — or moved to a
 * private board — between rendering and sending.
 */
describe("evaluateNotifiedBoardVisibility", () => {
  it("denies when the mail names a post that was not public at render time", () => {
    // The post is deleted before the send, so the current rows no longer show
    // its private board while its title is still in the stored payload.
    expect(
      evaluateNotifiedBoardVisibility({
        captured: "PRIVATE",
        current: "PUBLIC",
      })
    ).toBe("PRIVATE");
    expect(
      evaluateNotifiedBoardVisibility({ captured: "PRIVATE", current: null })
    ).toBe("PRIVATE");
    expect(
      evaluateNotifiedBoardVisibility({
        captured: "PRIVATE",
        current: "PRIVATE",
      })
    ).toBe("PRIVATE");
  });

  it("denies when a named post is not public now", () => {
    expect(
      evaluateNotifiedBoardVisibility({
        captured: "PUBLIC",
        current: "PRIVATE",
      })
    ).toBe("PRIVATE");
  });

  it("admits when both the snapshot and the current rows are public", () => {
    expect(
      evaluateNotifiedBoardVisibility({
        captured: "PUBLIC",
        current: "PUBLIC",
      })
    ).toBe("PUBLIC");
  });

  it("fails closed once every named post is gone", () => {
    // The mail named a post that was public at render and is deleted now, so
    // nothing is left proving the content stayed public. Deletion is the
    // strongest removal action; it must not be the one that still ships the
    // title to a recipient without workspace membership.
    expect(
      evaluateNotifiedBoardVisibility({ captured: "PUBLIC", current: null })
    ).toBe(null);
  });

  it("leaves an unproven snapshot to the current rows", () => {
    // `null` means the mail named no post at all, so there is nothing to prove.
    expect(
      evaluateNotifiedBoardVisibility({ captured: null, current: "PUBLIC" })
    ).toBe("PUBLIC");
    expect(
      evaluateNotifiedBoardVisibility({ captured: null, current: "PRIVATE" })
    ).toBe("PRIVATE");
    expect(
      evaluateNotifiedBoardVisibility({ captured: null, current: null })
    ).toBe(null);
  });

  it("leaves a delivery written before the snapshot to the current rows", () => {
    expect(
      evaluateNotifiedBoardVisibility({
        captured: undefined,
        current: "PUBLIC",
      })
    ).toBe("PUBLIC");
    expect(
      evaluateNotifiedBoardVisibility({
        captured: undefined,
        current: "PRIVATE",
      })
    ).toBe("PRIVATE");
    expect(
      evaluateNotifiedBoardVisibility({ captured: undefined, current: null })
    ).toBe(null);
  });
});
