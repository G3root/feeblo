import { defineConfig } from "oxfmt";

export default defineConfig({
  arrowParens: "always",
  bracketSameLine: false,
  bracketSpacing: true,
  endOfLine: "lf",
  ignorePatterns: [
    // Dependencies / VCS
    "**/node_modules",
    "**/.git",

    // Build output
    "**/dist",
    "**/build",
    "**/out",
    "**/.turbo",

    // Framework caches & generated output
    "**/.astro",
    "**/.wrangler",
    "**/.cache",
    "**/.vite",

    // Test artifacts
    "**/coverage",
    "**/.nyc_output",
    "**/playwright-report",
    "**/test-results",

    // Generated source
    "**/routeTree.gen.ts",
    "apps/web/src/paraglide/**",
    "apps/web/worker-configuration.d.ts",
    "packages/feedback-widget/src/icons/types.ts",
    "packages/feedback-widget/src/icons/sprite.svg",
    // The icon picker's sprite, metadata and licence are generated from
    // `@tabler/icons` by `packages/ui/scripts/generate-tabler-filled-sprite.ts`.
    // Reformatting them would make every regeneration a whole-file diff, and
    // the generator owns their layout. See `docs/adr/0030`.
    "packages/ui/src/icon-picker/generated/**",

    // Drizzle migrations (generated SQL + metadata)
    "packages/db/src/migrations/**",

    // Lock files & incremental build cache
    "**/pnpm-lock.yaml",
    "**/*.tsbuildinfo",

    "**/.agents",
    // The vendored Oxlint plugins (`tools/oxlint/**`) are copied from their
    // upstream repositories and keep upstream's formatting, which is tabs. They
    // are excluded from linting for the same reason; reformatting them would
    // make every future update a merge conflict in files this repo does not own.
    "tools/oxlint/**",
  ],
  jsxSingleQuote: false,
  printWidth: 80,
  proseWrap: "never",
  quoteProps: "as-needed",
  semi: true,
  singleQuote: false,
  sortImports: {
    ignoreCase: true,
    newlinesBetween: true,
    order: "asc",
  },
  sortPackageJson: true,
  sortTailwindcss: {
    functions: ["clsx", "cva", "tw", "twMerge", "cn", "twJoin", "tv"],
  },
  tabWidth: 2,
  trailingComma: "es5",
  useTabs: false,
});
