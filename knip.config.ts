import { existsSync } from "node:fs";

import { defineConfig } from "knip/config";

/**
 * Knip finds unused files, dependencies and exports.
 *
 * It is adopted in stages. `pnpm check` runs it, so the rules marked `error`
 * below are enforced on every push, and the ones marked `warn` are a standing
 * report: printed, not counted, and never hidden. Clean a type, then move its
 * rule to `error` in the same change. Adding to the `warn` list to get a run
 * green is the one thing this file is not for.
 */

/**
 * Paraglide compiles the message catalogue into a `src/paraglide` directory per
 * app, and those directories are gitignored. Knip honours `.gitignore`, so a
 * compiled tree needs no configuration at all: the generated exports never
 * enter the report.
 *
 * The other state is the one that does: a fresh clone, and CI before
 * `build:paraglide` runs, has no `src/paraglide`, and the relative import every
 * page makes into it resolves to nothing. Without the exception that is 93
 * unresolved imports that say nothing about the change under review, and
 * `pnpm check` is not allowed to need build output.
 */
const paraglideOutputDirectories = [
  "apps/web/src/paraglide",
  "apps/public-feature-board/src/paraglide",
  "packages/post-ui/src/paraglide",
];

const paraglideIsCompiled = paraglideOutputDirectories.every((directory) =>
  existsSync(directory)
);

/**
 * The exception has to be set on each workspace that imports into the
 * generated directory, not at the root: Knip applies `ignoreUnresolved` per
 * workspace, and a root-level value covers only the root workspace.
 */
const paraglideWorkspaceConfig = paraglideIsCompiled
  ? {}
  : { ignoreUnresolved: ["paraglide/(messages|runtime|server)\\.js$"] };

export default defineConfig({
  // An export the same file also uses is a file-local helper that happens to be
  // exported, not a dead public surface. This repo exports components and
  // schema constants for their own JSX and tests that way. Without this option
  // 74 of the 123 export findings are file-local.
  ignoreExportsUsedInFile: true,

  // The defaults are right for most of the tree; these are the places where the
  // import graph cannot see a real reference.
  workspaces: {
    // The root Playwright config is an entry a developer runs
    // (`npx playwright test` from the repository root). It imports
    // `@playwright/test` and the suite, which live in the `e2e` workspace; the
    // root deliberately does not declare a second copy of the runner.
    ".": {
      entry: ["playwright.config.ts"],
      ignoreDependencies: ["@effect/language-service", "@playwright/test"],
    },

    // `servers.ts` spawns this watchdog through a path it builds at runtime, so
    // no import edge points at it.
    e2e: {
      entry: ["scripts/parent-watchdog.mjs"],
    },

    // The Dockerfile copies `packages/db-migrator/dist` into the server image
    // and runs it before the app starts. Nothing imports the package from
    // TypeScript, but the dependency is what puts it in the build graph.
    "apps/server": {
      ignoreDependencies: ["@feeblo/db-migrator"],
    },

    // `@effect/language-service` is the type-checker plugin `effect-tsgo`
    // patches into `tsrs`; `react` is the base config's `jsxImportSource`.
    // Neither is a package dependency of the workspace that names it.
    "packages/config": {
      ignoreDependencies: ["@effect/language-service", "react"],
    },
    "packages/ui": {
      ignoreDependencies: ["@effect/language-service"],
    },

    "apps/web": {
      ...paraglideWorkspaceConfig,
      ignoreDependencies: ["@effect/language-service"],
    },
    "apps/public-feature-board": paraglideWorkspaceConfig,
    "packages/post-ui": paraglideWorkspaceConfig,
  },

  rules: {
    catalog: "error",
    catalogReferences: "error",
    duplicates: "error",
    unresolved: "error",
    enumMembers: "error",
    namespaceMembers: "error",
    files: "error",
    dependencies: "error",
    devDependencies: "error",
    exports: "error",
    types: "error",

    // 51 imports of packages no workspace declares. With the hoisted node
    // linker they resolve through a sibling's dependency, so they work by
    // accident. Fixing them adds dependencies, which needs an owner decision.
    unlisted: "warn",
    // `vite` in `apps/web` scripts; declaring it is a dependency change.
    binaries: "warn",
  },
});
