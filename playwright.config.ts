import { defineConfig } from "@playwright/test";

import e2eConfig from "./e2e/playwright.config";

/**
 * Root-level Playwright config so e2e tests can be run from the repository
 * root (`npx playwright test e2e/tests/...`) without needing to know that the
 * real config lives in `e2e/`.
 *
 * The servers are started by `e2e/fixtures.ts`, which resolves its paths from
 * its own location, so a root-level run needs no `webServer` setup here.
 *
 * Relative paths that live in the e2e config (`testDir`, `outputDir`) resolve
 * against the root config file, so they are re-pointed at `e2e/` here.
 */
export default defineConfig({
  ...e2eConfig,
  testDir: "./e2e/tests",
  outputDir: "./e2e/test-results",
});
