import { defineConfig } from "vitest/config";

import { pgliteTestOptions } from "../../packages/domain/test/vitest-preset";

export default defineConfig({
  test: {
    ...pgliteTestOptions,
    include: ["src/**/*.test.ts"],
  },
});
