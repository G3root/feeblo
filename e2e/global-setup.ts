import type { FullConfig } from "@playwright/test";

import { startWorkerServers, writeServerManifest } from "./servers";

/**
 * Starts one isolated product per Playwright worker before any worker exists.
 *
 * Fixtures get the test timeout for setup, and two servers booting under load
 * do not reliably fit in sixty seconds; global setup has no such deadline.
 * Each worker then reads its entry from the manifest this writes.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const manifest = await startWorkerServers(config.workers);
  process.env.E2E_SERVERS_FILE = await writeServerManifest(manifest);
}
