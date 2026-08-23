import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["../../packages/domain/test/global-setup.ts"],
    include: ["src/**/*.test.ts"],
    pool: "threads",
    setupFiles: ["../../packages/domain/test/setup.ts"],
  },
});
