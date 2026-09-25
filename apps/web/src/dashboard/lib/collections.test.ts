import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The SSR bundle evaluates this module at Workers global scope, where
 * `crypto.randomUUID()` and `crypto.getRandomValues()` throw ("Disallowed
 * operation called within global scope") and take the isolate down with them.
 * `createCollection` reaches for a random UUID unless the config carries an
 * explicit `id`, so this test is the guard that keeps every collection named.
 */
describe("dashboard collections module evaluation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generates no random values at module scope", async () => {
    const failRandomValue = () => {
      throw new Error("random value generated in global scope");
    };

    vi.stubGlobal("crypto", {
      getRandomValues: failRandomValue,
      randomUUID: failRandomValue,
    });

    await expect(import("./collections")).resolves.toBeDefined();
  });
});
