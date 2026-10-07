import { test as base } from "@playwright/test";

import { readServerManifest, type WorkerServer } from "./servers";

export { expect } from "@playwright/test";
export type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

type WorkerFixtures = {
  app: WorkerServer;
};

/**
 * Each Playwright worker runs against its own product instance.
 *
 * `global-setup.ts` starts one API server, one web server and one PGlite
 * directory per worker and writes them to a manifest; this fixture only
 * claims the entry for its worker. Starting servers here instead would put
 * their boot under the test timeout, and two boots under load do not fit.
 *
 * The old shared server served every worker one database, and concurrent
 * writes dropped connections during auth setup badly enough that helpers
 * retried them. Isolation is what removes that contention, so the retries go
 * away with it.
 */
export const test = base.extend<{ baseURL: string }, WorkerFixtures>({
  app: [
    async ({}, use, workerInfo) => {
      const manifestFile = process.env.E2E_SERVERS_FILE;
      if (manifestFile === undefined || manifestFile === "") {
        throw new Error(
          "The e2e servers are not running. Run the suite through Playwright so global-setup.ts starts them."
        );
      }

      const manifest = await readServerManifest(manifestFile);
      // Playwright restarts a worker after a failed test, and the replacement
      // gets the next worker index, so a long run produces more indices than
      // the run started workers. Map each index back onto the pool; workers
      // that are alive at the same time still land on distinct servers.
      const server =
        manifest.servers[workerInfo.workerIndex % manifest.servers.length];
      if (server === undefined) {
        throw new Error(
          `No e2e server is registered for worker ${workerInfo.workerIndex}.`
        );
      }

      // Helpers read these at call time, after this fixture has run, so each
      // worker's URLs reach `apiUrl()` and `webUrl()`.
      process.env.E2E_API_URL = server.apiURL;
      process.env.E2E_BASE_URL = server.webURL;

      await use(server);
    },
    { scope: "worker" },
  ],

  // The built-in `page`, `context` and `request` fixtures resolve `baseURL`
  // from this option, so every spec navigates this worker's web server.
  baseURL: async ({ app }, use) => {
    await use(app.webURL);
  },
});
