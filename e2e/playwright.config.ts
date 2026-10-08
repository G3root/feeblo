import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/**
 * Each worker runs its own API server, web server, PGlite database and Chromium
 * process. That is roughly four cores of work, so four workers on a ten-core
 * laptop starve editor chunks past the ten-second expect timeout. The budget
 * follows the machine; CI keeps the two workers it has always used.
 */
const localWorkers = Math.max(
  1,
  Math.min(4, Math.floor(availableParallelism() / 4))
);

/**
 * There is no `webServer` block here on purpose.
 *
 * `e2e/global-setup.ts` starts one API server, one web server and one PGlite
 * database per Playwright worker on OS-assigned ports. The previous config
 * started a single pair for the whole run, so every worker wrote to one
 * database and the servers dropped connections under the concurrent auth
 * traffic; helpers retried those drops. Isolation removes the cause, so tests
 * no longer retry.
 *
 * The apps must be built before a run. `pnpm --filter @feeblo/e2e test` builds
 * them; `test:ci` expects the CI `build_app` job to have built them already.
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  // Absolute so the root config can spread this config unchanged; a relative
  // path would resolve against the config that runs, not this one.
  globalSetup: fileURLToPath(new URL("./global-setup.ts", import.meta.url)),
  globalTeardown: fileURLToPath(
    new URL("./global-teardown.ts", import.meta.url)
  ),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Each worker runs its own server pair plus PGlite, so the worker count is a
  // budget for real processes rather than a count of browser tabs.
  workers: process.env.CI ? 2 : localWorkers,
  reporter: process.env.CI
    ? [["line"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
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
});
