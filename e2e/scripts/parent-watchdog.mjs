/**
 * Exits a server when the Playwright worker that started it dies.
 *
 * Playwright kills a worker with SIGKILL when a test times out, so the
 * worker's fixture teardown never runs. A detached server would otherwise
 * outlive its worker and compete with every later run, which is exactly what
 * happened before this file existed. A SIGKILLed parent leaves no signal
 * except reparenting, so `process.ppid` changing is the check.
 *
 * This loads through `NODE_OPTIONS=--import=...` into both the `tsx` wrapper
 * and the Node process it spawns; each watches its own parent, so the pair
 * exits together once the worker is gone.
 */
const parentPid = process.ppid;

const timer = setInterval(() => {
  if (process.ppid !== parentPid) {
    process.exit(0);
  }
}, 1000);

// The server's own handles keep the process alive; this timer must not.
timer.unref();
