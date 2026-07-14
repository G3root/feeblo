import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const serverPort = new URL(apiURL).port || "3100";
const databaseURL =
  process.env.E2E_DATABASE_URL ??
  `pglite:${mkdtempSync(path.join(tmpdir(), "feeblo-e2e-"))}`;

const e2eEnv = {
  APP_ROOT_DOMAIN: "localhost",
  APP_URL: baseURL,
  API_URL: apiURL,
  AUTH_AUTO_SIGN_IN_AFTER_SIGN_UP: "true",
  AUTH_EMAIL_VERIFICATION_REQUIRED: "false",
  AUTH_ENCRYPTION_KEY: "playwright-e2e-local-secret-32-chars",
  DATABASE_URL: databaseURL,
  NODE_ENV: "development",
  SERVER_PORT: serverPort,
};

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "on-failure" }]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: "pnpm run dev:server:e2e",
      env: e2eEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${apiURL}/health`,
    },
    {
      command: "pnpm run dev:web:e2e",
      env: e2eEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      url: baseURL,
    },
  ],
});
