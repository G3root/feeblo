import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Bounds a run that a wedged PGlite worker would otherwise hang forever; see
// `tools/vitest/watchdog.ts`.
const watchdogPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tools",
  "vitest",
  "watchdog.ts"
);

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: [watchdogPath],
    globals: false,
    // PGlite drives its own internal worker threads, which can deadlock with
    // Vitest's default fork pool during process teardown and intermittently
    // hang the suite forever. `api-key.test.ts` is this package's PGlite
    // suite — it migrates one file-backed cluster at module scope and disposes
    // it in `afterAll` — so it takes the same setting the db, domain, and
    // integration suites already use. See `packages/db/vitest.config.ts`.
    pool: "threads",
    // The `afterAll` close checkpoints the cluster, and under a full
    // `turbo run test` that is slower than the ten-second default; a slow
    // machine must read as slow, not as a failed teardown.
    hookTimeout: 30_000,
  },
});
