import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Unit tests for the app's pure logic (subdomain routing, env parsing) and for
 * module-scope behaviour the SSR bundle depends on (collection evaluation).
 *
 * Deliberately separate from `vite.config.ts`: the app config loads the Start
 * plugin, Tailwind, and Paraglide, none of which these tests need.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the tsconfig's `~/*` → `src/dashboard/*` mapping.
      "~": fileURLToPath(new URL("./src/dashboard", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The collections module-evaluation test imports the dashboard graph,
    // which can exceed the 5s default while turbo is running every package's
    // tests in parallel. Keep slow-under-load a slow test, not a flake.
    testTimeout: 15_000,
  },
});
