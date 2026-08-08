import { defineConfig } from "@playwright/test";
import e2eConfig from "./e2e/playwright.config";

/**
 * Root-level Playwright config so e2e tests can be run from the repository
 * root (`npx playwright test e2e/tests/...`) without needing to know that the
 * real config lives in `e2e/`.
 *
 * Without this file, running from the root ignores the `webServer` setup in
 * `e2e/playwright.config.ts` and every test fails with `ECONNREFUSED` against
 * the API server (port 3100) that Playwright was supposed to start.
 *
 * Relative paths that live in the e2e config (`testDir`, `outputDir`) resolve
 * against the root config file, so they are re-pointed at `e2e/` here. The
 * `webServer` entries keep their explicit `cwd` from the e2e config.
 */
export default defineConfig({
  ...e2eConfig,
  testDir: "./e2e/tests",
  outputDir: "./e2e/test-results",
});
