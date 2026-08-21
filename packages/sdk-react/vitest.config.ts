import { fileURLToPath } from "node:url";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Tests run against the real `@feeblo/sdk` source (no module mocking) so the
 * React bindings are exercised through the same public surface consumers use.
 */
const sdkSource = fileURLToPath(
  new URL("../sdk/src/index.ts", import.meta.url)
);

export default defineConfig({
  test: {
    projects: [
      {
        define: {
          // Mirrors the production `__FEEBLO_VERSION__` define so the aliased
          // SDK source never references an undefined global in tests.
          __FEEBLO_VERSION__: JSON.stringify("0.0.0-test"),
        },
        resolve: {
          alias: {
            "@feeblo/sdk": sdkSource,
          },
        },
        test: {
          api: {
            host: "127.0.0.1",
            port: 63_317,
          },
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright(),
          },
          globals: false,
          include: ["src/**/*.browser.test.{ts,tsx}"],
          name: "browser",
        },
      },
    ],
  },
});
