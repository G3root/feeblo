import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          environment: "node",
          globals: false,
          include: ["src/**/*.test.ts"],
          name: "unit",
        },
      },
      {
        test: {
          api: {
            host: "127.0.0.1",
            port: 63_316,
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
