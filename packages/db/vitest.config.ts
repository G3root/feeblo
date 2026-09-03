import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // PGlite drives its own internal worker threads, which can deadlock with
    // Vitest's default fork pool during process teardown and intermittently
    // hang CI forever. Running the pool in worker threads keeps PGlite
    // in-process, matching the domain package's setup.
    pool: "threads",
  },
});
