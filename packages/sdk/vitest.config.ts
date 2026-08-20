import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __FEEBLO_VERSION__: JSON.stringify("0.0.0-test"),
  },
  test: {
    projects: [
      {
        define: {
          __FEEBLO_VERSION__: JSON.stringify("0.0.0-test"),
        },
        test: {
          name: "unit",
          environment: "happy-dom",
          include: ["test/**/*.test.ts"],
          globals: false,
        },
      },
      {
        define: {
          __FEEBLO_VERSION__: JSON.stringify("0.0.0-test"),
        },
        test: {
          name: "browser",
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright(),
          },
          include: ["src/react/**/*.browser.test.{ts,tsx}"],
          globals: false,
          api: {
            host: "127.0.0.1",
            port: 63317,
          },
        },
      },
    ],
  },
});
