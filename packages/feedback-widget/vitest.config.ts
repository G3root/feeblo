import { defineConfig } from "vitest/config";

/**
 * The widget's tests are about the iframe's request/response boundary, not the
 * Solid render tree, so they need neither a DOM nor the Solid plugin: the
 * request helpers are plain functions and the shell's globals are stubbed with
 * `vi.stubGlobal`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "threads",
  },
});
