import { defineConfig } from "vitest/config";

/**
 * Unit tests for the app's pure logic (subdomain routing, env parsing).
 *
 * Deliberately separate from `vite.config.ts`: the app config loads the Start
 * plugin, Tailwind, and Paraglide, none of which a pure-function test needs.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
