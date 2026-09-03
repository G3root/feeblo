import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // PGlite boots an embedded Postgres (plus the pgvector WASM extension),
    // which takes ~1.5s locally and longer on shared CI runners, especially
    // with turbo running packages concurrently. Keep the timeout generous so
    // slow boot is a slow test, not a flaky timeout.
    testTimeout: 30_000,
    // PGlite drives its own internal worker threads, which can deadlock with
    // Vitest's default fork pool during process teardown and intermittently
    // hang CI forever. Running the pool in worker threads keeps PGlite
    // in-process, matching the domain package's setup.
    pool: "threads",
  },
});
