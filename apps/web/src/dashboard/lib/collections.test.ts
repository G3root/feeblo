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

  it(
    "generates no random values at module scope",
    // The assertion is about module-scope evaluation, so the test has to import
    // the real module and pay for the whole client graph it pulls in. That is
    // ~0.7s here and was 5.04s on a two-core CI runner while four Vitest
    // processes competed, which is over the 5s default and failed the job on a
    // commit that changed nothing this test touches. The budget is for the cold
    // import, not for the assertion: a module that never finishes evaluating
    // still fails, just after 30s instead of 5.
    { timeout: 30_000 },
    async () => {
      const failRandomValue = () => {
        throw new Error("random value generated in global scope");
      };

      vi.stubGlobal("crypto", {
        getRandomValues: failRandomValue,
        randomUUID: failRandomValue,
      });

      await expect(import("./collections")).resolves.toBeDefined();
    }
  );
});
