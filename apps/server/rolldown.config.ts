import { createRequire } from "node:module";
import path from "node:path";

import { defineConfig } from "rolldown";

const require = createRequire(import.meta.url);

/** The ESM build of `@opentelemetry/api`; its `exports` map hides this subpath. */
const otelApi = path.join(
  path.dirname(require.resolve("@opentelemetry/api")),
  "index.mjs"
);

export default defineConfig({
  input: "./src/index.ts",
  platform: "node",
  resolve: {
    // `@sentry/node` pulls `@opentelemetry/api`, whose CommonJS entry trips
    // Rolldown's interop (`require_types` before initialization). The ESM
    // entry is the same API without the CJS wrapper.
    alias: {
      "@opentelemetry/api": otelApi,
    },
  },
  output: {
    dir: "dist",
    format: "esm",
  },
});
