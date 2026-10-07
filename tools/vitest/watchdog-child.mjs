/**
 * Kills the test runner when its run exceeds the deadline.
 *
 * The parent starts this from `watchdog.ts` and kills it on normal completion.
 * When the parent is SIGKILLed instead, the poll sees it disappear and exits,
 * so a crashed run cannot leave a watchdog behind. The deadline is the only
 * case where this process sends a signal.
 */
const parentPid = Number(process.argv[2]);
const deadlineMs = Number(process.argv[3]);

const parentAlive = () => {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
};

const deadline = setTimeout(() => {
  console.error(
    `[vitest-watchdog] test run exceeded ${deadlineMs}ms; killing pid ${parentPid}`
  );
  try {
    process.kill(parentPid, "SIGKILL");
  } catch {
    // The runner is already gone.
  }
}, deadlineMs);

const poll = setInterval(() => {
  if (!parentAlive()) {
    clearTimeout(deadline);
    clearInterval(poll);
    process.exit(0);
  }
}, 1_000);
