import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Bounds a test run that a blocked worker would otherwise hang forever.
 *
 * A PGlite WASM trap can leave a worker thread spinning inside V8's error
 * construction, where `testTimeout` never fires because the worker's event loop
 * is blocked. This global setup starts a child that SIGKILLs the runner once
 * the whole package run exceeds the deadline, turning a hang into a failed task
 * with a log line. The default is a safety net far above a healthy run; set
 * `FEEBLO_TEST_DEADLINE_MS=0` to disable it.
 *
 * `pool: "threads"` runs the tests in the same process, so killing the runner
 * is the only way to stop a worker thread that is not returning.
 */
const defaultDeadlineMs = 10 * 60 * 1000;

let watchdog: ChildProcess | undefined;

export function setup(): void {
  const configured = process.env.FEEBLO_TEST_DEADLINE_MS;
  const deadlineMs =
    configured === undefined ? defaultDeadlineMs : Number(configured);

  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return;
  }

  watchdog = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./watchdog-child.mjs", import.meta.url)),
      String(process.pid),
      String(deadlineMs),
    ],
    { detached: true, stdio: ["ignore", "inherit", "inherit"] }
  );
  watchdog.unref();
}

export function teardown(): void {
  watchdog?.kill();
  watchdog = undefined;
}
