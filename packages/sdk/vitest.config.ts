import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // Mirrors the production `__FEEBLO_VERSION__` define (vite.config.ts) so the
    // version module never references an undefined global in tests.
    __FEEBLO_VERSION__: JSON.stringify("0.0.0-test"),
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
