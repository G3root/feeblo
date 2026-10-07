import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { isString } from "@feeblo/utils/runtime-kind";

const execFileAsync = promisify(execFile);

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(e2eDirectory, "..");
const serverDirectory = path.join(repositoryRoot, "apps", "server");
const tsxBinary = path.join(repositoryRoot, "node_modules", ".bin", "tsx");
const migrateScript = path.join(e2eDirectory, "scripts", "migrate-pglite.ts");
const serverEntry = path.join(serverDirectory, "src", "index.ts");
const webEntry = path.join(repositoryRoot, "apps", "web", "server.mjs");
const parentWatchdogUrl = pathToFileURL(
  path.join(e2eDirectory, "scripts", "parent-watchdog.mjs")
).href;

/** How long a worker waits for its own servers to answer. */
const readinessTimeoutMs = 240_000;

/** How long teardown waits after SIGTERM before it escalates to SIGKILL. */
const gracefulShutdownMs = 10_000;

/** The prefix `mkdtempSync` gives every run directory. */
const runDirectoryPrefix = "feeblo-e2e-run-";

/**
 * How old an abandoned run directory must be before a new run removes it.
 *
 * The watchdog stops the servers a killed runner leaves behind, but nothing
 * removes their directory, and each one holds a PGlite cluster per worker. The
 * cutoff is far longer than any run, so a directory a concurrent run is still
 * writing to is never a candidate; a hard-killed run is reclaimed the next
 * time tests start.
 */
const staleRunAgeMs = 2 * 60 * 60 * 1000;

/** One product instance: an API server, a web server and a PGlite directory. */
export type WorkerServer = {
  readonly worker: number;
  readonly apiURL: string;
  readonly webURL: string;
  readonly databaseDirectory: string;
  readonly apiPid: number | undefined;
  readonly webPid: number | undefined;
};

export type ServerManifest = {
  readonly runDirectory: string;
  readonly servers: readonly WorkerServer[];
};

/** A port the OS just handed out, so concurrent workers cannot collide. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || isString(address)) {
        reject(new Error("Port probe did not return a TCP address"));
        return;
      }
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });

/**
 * The old `webServer` block ran one environment for one server pair. Every
 * value here is unchanged; the three that must differ per worker - ports,
 * database and origins - are arguments.
 */
const serverEnvironment = (input: {
  apiPort: number;
  apiURL: string;
  databaseURL: string;
  webPort: number;
  webURL: string;
}): NodeJS.ProcessEnv => ({
  APP_ROOT_DOMAIN: "localhost",
  APP_URL: input.webURL,
  API_URL: input.apiURL,
  AUTH_AUTO_SIGN_IN_AFTER_SIGN_UP: "true",
  AUTH_EMAIL_VERIFICATION_REQUIRED: "true",
  AUTH_ENCRYPTION_KEY: "playwright-e2e-local-secret-32-chars",
  AUTH_TRUSTED_ORIGINS: `${input.webURL},${input.apiURL},*.localhost:${input.webPort}`,
  CLOUDFLARE_ADAPTER: "false",
  DATABASE_URL: input.databaseURL,
  E2E_TEST_MAILER: "true",
  EMAIL_PROVIDER_WEBHOOK_TOKEN: "playwright-email-provider-token",
  HOST: "127.0.0.1",
  INTEGRATION_ALLOW_PRIVATE_NETWORK: "true",
  INTEGRATION_ENCRYPTION_KEY:
    "b8d5fa3eebc62aead2c54d03abccbfcc2ff84c214a53e4887f63b43f71a5a2d3",
  MEDIA_PUBLIC_BUCKET_NAME: "feeblo-media-public",
  MEDIA_UPLOAD_ACCESS_KEY_ID: "feeblo",
  MEDIA_UPLOAD_ENDPOINT: "http://127.0.0.1:9002",
  MEDIA_UPLOAD_REGION: "us-east-1",
  MEDIA_UPLOAD_SECRET_ACCESS_KEY: "password",
  NODE_ENV: "development",
  PORT: String(input.webPort),
  SERVER_PORT: String(input.apiPort),
});

const startProcess = (input: {
  args: readonly string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): ChildProcess => {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    // A new process group is what lets teardown stop everything the server
    // spawned, not only the process it started.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return child;
};

/** Appends server output to a file so a failed readiness check can quote it. */
const pipeToFile = (child: ChildProcess, logPath: string): void => {
  const write = (chunk: Buffer): void => {
    void appendFile(logPath, chunk).catch(() => undefined);
  };

  child.stdout?.on("data", write);
  child.stderr?.on("data", write);
};

const readLogTail = async (logPath: string): Promise<string> => {
  const output = await readFile(logPath, "utf8").catch(() => "");
  return output.split("\n").slice(-40).join("\n").trim();
};

/**
 * Waits for a server to answer its own readiness URL.
 *
 * The probes use `127.0.0.1` while the origins use `localhost`: Node resolves
 * `localhost` to `::1` first on some machines, and the servers bind IPv4 only.
 */
const waitForHttp = async (input: {
  label: string;
  logPath: string;
  process: ChildProcess;
  url: string;
}): Promise<void> => {
  const deadline = Date.now() + readinessTimeoutMs;

  while (Date.now() < deadline) {
    if (input.process.exitCode !== null) {
      throw new Error(
        `${input.label} exited before becoming ready (${input.process.exitCode}).\n${await readLogTail(
          input.logPath
        )}`
      );
    }
    try {
      const response = await fetch(input.url, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        await response.body?.cancel();
        return;
      }
    } catch {
      // The server is still starting; the deadline decides when that is a failure.
    }
    await delay(250);
  }

  throw new Error(
    `${input.label} did not answer ${input.url} within ${readinessTimeoutMs}ms.\n${await readLogTail(
      input.logPath
    )}`
  );
};

const processGroupExists = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stops a detached process group, escalating only when SIGTERM does not land. */
const stopProcessGroup = async (pid: number | undefined): Promise<void> => {
  if (pid === undefined) {
    return;
  }

  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is already gone; nothing left to stop.
    }
  };

  signalGroup("SIGTERM");
  const deadline = Date.now() + gracefulShutdownMs;
  while (Date.now() < deadline && processGroupExists(pid)) {
    await delay(200);
  }
  if (processGroupExists(pid)) {
    signalGroup("SIGKILL");
  }
};

/**
 * Starts one worker's product instance: migrate its own PGlite directory, then
 * run the API and web servers on OS-assigned ports.
 *
 * This runs from `global-setup.ts`, not from a fixture: Playwright gives
 * fixture setup the test timeout, and two servers booting under load do not
 * reliably fit in sixty seconds. Global setup has no such deadline.
 */
const startWorkerServer = async (
  worker: number,
  runDirectory: string
): Promise<WorkerServer> => {
  const databaseDirectory = path.join(runDirectory, `worker-${worker}`);
  await mkdir(databaseDirectory, { recursive: true });
  const databaseURL = `pglite:${databaseDirectory}`;

  const apiPort = await freePort();
  let webPort = await freePort();
  while (webPort === apiPort) {
    webPort = await freePort();
  }
  const apiURL = `http://localhost:${apiPort}`;
  const webURL = `http://localhost:${webPort}`;

  const inheritedNodeOptions = process.env.NODE_OPTIONS;
  const env = {
    ...process.env,
    ...serverEnvironment({ apiPort, apiURL, databaseURL, webPort, webURL }),
    // A runner killed with SIGKILL never reaches its global teardown. The
    // watchdog makes each server exit when its parent is gone; see the file for
    // why reparenting is the only signal a SIGKILLed parent leaves behind.
    NODE_OPTIONS:
      inheritedNodeOptions === undefined || inheritedNodeOptions === ""
        ? `--import=${parentWatchdogUrl}`
        : `${inheritedNodeOptions} --import=${parentWatchdogUrl}`,
  };

  const apiLogPath = path.join(databaseDirectory, "api.log");
  const webLogPath = path.join(databaseDirectory, "web.log");

  await execFileAsync(tsxBinary, [migrateScript], {
    cwd: e2eDirectory,
    env,
    timeout: 120_000,
  });

  const api = startProcess({
    args: [serverEntry],
    command: tsxBinary,
    cwd: serverDirectory,
    env,
  });
  pipeToFile(api, apiLogPath);

  const web = startProcess({
    args: [webEntry],
    command: process.execPath,
    cwd: repositoryRoot,
    env,
  });
  pipeToFile(web, webLogPath);

  try {
    await Promise.all([
      waitForHttp({
        label: `API server (worker ${worker})`,
        logPath: apiLogPath,
        process: api,
        url: `http://127.0.0.1:${apiPort}/health`,
      }),
      waitForHttp({
        label: `web server (worker ${worker})`,
        logPath: webLogPath,
        process: web,
        url: `http://127.0.0.1:${webPort}`,
      }),
    ]);
  } catch (error) {
    await stopProcessGroup(web.pid);
    await stopProcessGroup(api.pid);
    throw error;
  }

  return {
    worker,
    apiURL,
    webURL,
    databaseDirectory,
    apiPid: api.pid,
    webPid: web.pid,
  };
};

/**
 * Removes run directories a hard-killed runner left behind.
 *
 * Best effort: a permissions problem or a directory another run removed first
 * must not turn into a test failure.
 */
const pruneAbandonedRunDirectories = async (): Promise<void> => {
  const entries = await readdir(tmpdir(), { withFileTypes: true }).catch(
    () => []
  );
  const removableBefore = Date.now() - staleRunAgeMs;

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith(runDirectoryPrefix)
      )
      .map(async (entry) => {
        const directory = path.join(tmpdir(), entry.name);
        const info = await stat(directory).catch(() => null);
        if (info !== null && info.mtimeMs < removableBefore) {
          await rm(directory, { force: true, recursive: true }).catch(
            () => undefined
          );
        }
      })
  );
};

/**
 * One isolated product per Playwright worker.
 *
 * Every worker gets its own PGlite directory, API server and web server on
 * OS-assigned ports. The old shared server served all workers one database,
 * and concurrent writes dropped connections during auth setup badly enough
 * that helpers retried them. Isolation is what removes that contention, so
 * the retries go away with it.
 *
 * Servers start one after another: parallel boots made the machine spend its
 * budget on compile contention, and the total is paid once per run either way.
 */
export const startWorkerServers = async (
  workerCount: number
): Promise<ServerManifest> => {
  await pruneAbandonedRunDirectories();
  const runDirectory = mkdtempSync(path.join(tmpdir(), runDirectoryPrefix));
  const servers: WorkerServer[] = [];
  try {
    for (let worker = 0; worker < workerCount; worker += 1) {
      servers.push(await startWorkerServer(worker, runDirectory));
    }
  } catch (error) {
    // A half-started run must not leave its servers or directory behind.
    await stopWorkerServers({ runDirectory, servers });
    throw error;
  }
  return { runDirectory, servers };
};

export const stopWorkerServers = async (
  manifest: ServerManifest
): Promise<void> => {
  for (const server of manifest.servers) {
    await stopProcessGroup(server.webPid);
    await stopProcessGroup(server.apiPid);
  }
  await rm(manifest.runDirectory, { force: true, recursive: true });
};

const serverManifestPath = (runDirectory: string): string =>
  path.join(runDirectory, "servers.json");

export const writeServerManifest = async (
  manifest: ServerManifest
): Promise<string> => {
  const file = serverManifestPath(manifest.runDirectory);
  await writeFile(file, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return file;
};

export const readServerManifest = async (
  file: string
): Promise<ServerManifest> => {
  // SAFETY: The file is written by `writeServerManifest` earlier in this same
  // run, so its shape is the one this process serialized.
  const manifest = JSON.parse(await readFile(file, "utf8")) as ServerManifest;
  return manifest;
};
