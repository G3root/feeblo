import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TestUserConfig } from "vitest/config";

const testDirectory = dirname(fileURLToPath(import.meta.url));

const fixturePath = (name: string): string => join(testDirectory, name);

// The watchdog lives at the repository root so the db and auth suites, which do
// not use this preset, reference the same one. `join` rather than `new URL`
// because this package's DOM lib supplies a different `URL` type than
// `fileURLToPath` accepts.
const watchdogPath = join(
  testDirectory,
  "..",
  "..",
  "..",
  "tools",
  "vitest",
  "watchdog.ts"
);

/**
 * Vitest options shared by every package that tests against this directory's
 * PGlite fixture: `@feeblo/domain` and the five integrations.
 *
 * The timeouts are the point. `packages/db/vitest.config.ts` already spells out
 * why PGlite needs a generous one - it boots an embedded Postgres plus the
 * pgvector WASM extension, "especially with turbo running packages concurrently"
 * - but the suites that pay the most never had it. A test file here clones the
 * 1370-file cluster `global-setup.ts` builds before it can run anything, and
 * `turbo run test` starts nineteen of these suites at once. That clone measures
 * ~0.27s with the machine to itself and ~3.4s while the rest of the run is
 * competing for it, so a five-second default turns a busy laptop into a red run.
 * A slow test should be slow, not flaky.
 *
 * The paths are absolute because they are resolved from this file rather than
 * from the config that spreads them, which is what lets the integrations share
 * one definition instead of repeating `../../packages/domain/test/...`.
 */
export const pgliteTestOptions: TestUserConfig = {
  environment: "node",
  globalSetup: [fixturePath("global-setup.ts"), watchdogPath],
  hookTimeout: 60_000,
  // PGlite runs entirely in-process; worker threads avoid the process startup
  // and IPC overhead of Vitest's default fork pool while preserving per-file
  // isolation and the fresh database created by setupFiles.
  pool: "threads",
  setupFiles: [fixturePath("setup.ts")],
  testTimeout: 30_000,
};
