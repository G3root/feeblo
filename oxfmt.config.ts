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

    // Drizzle migrations (generated SQL + metadata)
    "packages/db/src/migrations/**",

    // Lock files & incremental build cache
    "**/pnpm-lock.yaml",
    "**/*.tsbuildinfo",

    "**/.agents",
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
