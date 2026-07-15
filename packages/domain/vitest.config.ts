import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    include: ["src/**/*.test.ts"],
    // PGlite runs entirely in-process; worker threads avoid the process
    // startup and IPC overhead of Vitest's default fork pool while preserving
    // per-file isolation and the fresh database created by setupFiles.
    pool: "threads",
    setupFiles: ["./test/setup.ts"],
  },
});
