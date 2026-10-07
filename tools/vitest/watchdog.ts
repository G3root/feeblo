import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { TestProject } from "vitest/node";

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

/**
 * The largest delay `setTimeout` can represent. Node clamps anything larger to
 * 1ms, which would SIGKILL a healthy run the moment it starts.
 */
const maxTimerMs = 2_147_483_647;

let watchdog: ChildProcess | undefined;

export function setup(project: TestProject): void {
  const configured = process.env.FEEBLO_TEST_DEADLINE_MS;
  const explicit = configured !== undefined && configured !== "";

  // A watcher is meant to stay open until the developer stops it, so the
  // default deadline does not apply there. An explicit deadline still does.
  if (!explicit && project.config.watch) {
    return;
  }

  const deadlineMs = explicit ? Number(configured) : defaultDeadlineMs;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return;
  }
  if (deadlineMs > maxTimerMs) {
    throw new Error(
      `FEEBLO_TEST_DEADLINE_MS must be at most ${maxTimerMs}ms: setTimeout cannot represent a longer delay and would fire after 1ms instead.`
    );
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
  // A failed spawn emits `error`; without a listener that becomes an unhandled
  // event and takes the runner down before the tests start.
  watchdog.once("error", (error) => {
    console.error(`[vitest-watchdog] could not start: ${error.message}`);
    watchdog = undefined;
  });
  watchdog.unref();
}

export function teardown(): void {
  watchdog?.kill();
  watchdog = undefined;
}
