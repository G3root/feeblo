import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Anchors the webServer commands to this config's directory so tests can be
// run from the repo root (via playwright.config.ts) or from e2e/ alike.
const configDir = path.dirname(fileURLToPath(import.meta.url));

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const serverPort = new URL(apiURL).port || "3100";
const webPort = new URL(baseURL).port || "3101";
const reuseBuiltApps = process.env.E2E_REUSE_BUILD === "true";
const databaseURL =
  process.env.E2E_DATABASE_URL ??
  `pglite:${mkdtempSync(path.join(tmpdir(), "feeblo-e2e-"))}`;

const toIPv4LoopbackURL = (url: string): string => {
  const readinessURL = new URL(url);
  if (readinessURL.hostname === "localhost") {
    readinessURL.hostname = "127.0.0.1";
  }
  return readinessURL.toString();
};

const e2eEnv = {
  APP_ROOT_DOMAIN: "localhost",
  APP_URL: baseURL,
  API_URL: apiURL,
  AUTH_AUTO_SIGN_IN_AFTER_SIGN_UP: "true",
  AUTH_EMAIL_VERIFICATION_REQUIRED: "true",
  AUTH_ENCRYPTION_KEY: "playwright-e2e-local-secret-32-chars",
  AUTH_TRUSTED_ORIGINS: `${baseURL},${apiURL},*.localhost:${webPort}`,
  CLOUDFLARE_ADAPTER: "false",
  DATABASE_URL: databaseURL,
  E2E_TEST_MAILER: "true",
  EMAIL_PROVIDER_WEBHOOK_TOKEN: "playwright-email-provider-token",
  HOST: "127.0.0.1",
  INTEGRATION_ALLOW_PRIVATE_NETWORK: "true",
  INTEGRATION_ENCRYPTION_KEY: "playwright-integration-key-32-bytes",
  MEDIA_PUBLIC_BUCKET_NAME: "feeblo-media-public",
  MEDIA_UPLOAD_ACCESS_KEY_ID: "feeblo",
  MEDIA_UPLOAD_ENDPOINT: "http://127.0.0.1:9002",
  MEDIA_UPLOAD_REGION: "us-east-1",
  MEDIA_UPLOAD_SECRET_ACCESS_KEY: "password",
  NODE_ENV: "development",
  PORT: webPort,
  SERVER_PORT: serverPort,
};

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI
    ? [["line"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    // Keep the first attempt's trace as well as its video when a retry passes.
    // This makes intermittent CI failures debuggable from the uploaded artifact.
    trace: "retain-on-failure",
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
      command: reuseBuiltApps
        ? "../node_modules/.bin/tsx scripts/migrate-pglite.ts && ../node_modules/.bin/tsx ../apps/server/src/index.ts"
        : "pnpm run dev:server:e2e",
      cwd: configDir,
      env: e2eEnv,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 240_000,
      url: toIPv4LoopbackURL(`${apiURL}/health`),
    },
    {
      command: reuseBuiltApps
        ? "node ../apps/web/dist/server/entry.mjs"
        : "pnpm run dev:web:e2e",
      cwd: configDir,
      env: e2eEnv,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 240_000,
      url: toIPv4LoopbackURL(baseURL),
    },
  ],
});
