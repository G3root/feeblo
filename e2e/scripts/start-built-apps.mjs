import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const e2eDirectory = resolve(currentDirectory, "..");
const repositoryDirectory = resolve(e2eDirectory, "..");
const logsDirectory = resolve(e2eDirectory, ".webserver-logs");
const apiLog = resolve(logsDirectory, "api.log");
const webLog = resolve(logsDirectory, "web.log");
const apiURL = process.env.API_URL ?? "http://localhost:3100";
const webURL = process.env.APP_URL ?? "http://localhost:3101";
const apiHealthURL = new URL("/health", apiURL);
const apiStartupTimeoutMs = 240_000;
const webStartupTimeoutMs = 60_000;

const processes = [];

const startProcess = ({ command, args, logFile }) => {
  const child = spawn(command, args, {
    cwd: e2eDirectory,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.push(child);

  const log = createWriteStream(logFile, { flags: "a" });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });

  return child;
};

const exitBeforeReady = (child, name) =>
  new Promise((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `${name} exited before becoming ready (code ${code ?? "none"}, signal ${signal ?? "none"}).`
        )
      );
    });
  });

const waitForURL = async ({ child, name, timeoutMs, url }) => {
  const deadline = Date.now() + timeoutMs;
  const exited = exitBeforeReady(child, name);
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health check returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 500)),
      exited,
    ]);
  }

  throw new Error(
    `${name} did not become ready within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
};

const stopProcesses = () => {
  for (const child of processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
};

const printLogs = async () => {
  for (const [name, logFile] of [
    ["API", apiLog],
    ["Web", webLog],
  ]) {
    const log = await readFile(logFile, "utf8").catch(() => "(no output)");
    console.error(`\n[e2e] ${name} server log:\n${log}`);
  }
};

process.once("SIGINT", stopProcesses);
process.once("SIGTERM", stopProcesses);

try {
  await rm(logsDirectory, { force: true, recursive: true });
  await mkdir(logsDirectory, { recursive: true });
  await Promise.all([writeFile(apiLog, ""), writeFile(webLog, "")]);

  const api = startProcess({
    command: resolve(repositoryDirectory, "node_modules/.bin/tsx"),
    args: ["scripts/migrate-pglite.ts"],
    logFile: apiLog,
  });
  await new Promise((resolvePromise, reject) => {
    api.once("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`PGlite migration failed with exit code ${code}.`))
    );
    api.once("error", reject);
  });

  const server = startProcess({
    command: resolve(repositoryDirectory, "node_modules/.bin/tsx"),
    args: ["../apps/server/src/index.ts"],
    logFile: apiLog,
  });
  await waitForURL({
    child: server,
    name: "API server",
    timeoutMs: apiStartupTimeoutMs,
    url: apiHealthURL,
  });

  const web = startProcess({
    command: process.execPath,
    args: ["../apps/web/dist/server/entry.mjs"],
    logFile: webLog,
  });
  await waitForURL({
    child: web,
    name: "Web server",
    timeoutMs: webStartupTimeoutMs,
    url: webURL,
  });
  await new Promise((resolvePromise, reject) => {
    web.once("exit", (code, signal) =>
      reject(
        new Error(
          `Web server exited (code ${code ?? "none"}, signal ${signal ?? "none"}).`
        )
      )
    );
    web.once("error", reject);
    process.once("SIGTERM", resolvePromise);
    process.once("SIGINT", resolvePromise);
  });
} catch (error) {
  stopProcesses();
  await printLogs();
  throw error;
}
