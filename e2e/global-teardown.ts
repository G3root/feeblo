import { readServerManifest, stopWorkerServers } from "./servers";

/** Stops the per-worker products `global-setup.ts` started. */
export default async function globalTeardown(): Promise<void> {
  const file = process.env.E2E_SERVERS_FILE;
  if (file === undefined || file === "") {
    return;
  }
  await stopWorkerServers(await readServerManifest(file));
}
