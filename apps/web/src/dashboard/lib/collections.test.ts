import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The SSR bundle evaluates this module at Workers global scope, where
 * `crypto.randomUUID()` and `crypto.getRandomValues()` throw ("Disallowed
 * operation called within global scope") and take the isolate down with them.
 * `createCollection` reaches for a random UUID unless the config carries an
 * explicit `id`, so this test is the guard that keeps every collection named.
 *
 * It imports the app's real collections module, so the import is the test: it
 * pulls in TanStack DB, React, and the query client before it can assert
 * anything. That takes seconds on an idle machine and much longer while
 * `turbo run test` is starting nineteen other suites, so the default five-second
 * budget reported a busy laptop as a crypto regression. The assertion is about
 * module-scope behaviour, not speed.
 */
describe("dashboard collections module evaluation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "generates no random values at module scope",
    { timeout: 60_000 },
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
