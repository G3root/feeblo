import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["eslint", "oxc", "unicorn", "typescript", "vitest"],
  categories: {
    correctness: "warn",
    suspicious: "warn",
    perf: "warn",
  },

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

    // Agent tooling & vendored plugins (not application source)
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    ".fallow/**",
    "tools/oxlint/anti-slop/**",
  ],

  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "react-doctor", specifier: "oxlint-plugin-react-doctor" },
  ],

  rules: {
    "unicorn/no-array-sort": "off",
    "unicorn/consistent-function-scoping": "off",
    "oxc/no-map-spread": "off",
    "react-in-jsx-scope": "off",
    "react-hooks/exhaustive-deps": "off",
    "eslint/no-shadow": "off",
    "eslint/no-await-in-loop": "off",
    "eslint/no-underscore-dangle": "off",
    "typescript/consistent-return": "off",
    "typescript/no-base-to-string": "off",
    "typescript/no-duplicate-type-constituents": "off",
    "typescript/no-floating-promises": "off",
    "typescript/no-implied-eval": "off",
    "typescript/no-meaningless-void-operator": "off",
    "typescript/no-redundant-type-constituents": "off",
    "typescript/no-unnecessary-boolean-literal-compare": "off",
    "typescript/no-unnecessary-type-conversion": "off",
    "typescript/no-unnecessary-type-arguments": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/no-unnecessary-type-parameters": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/await-thenable": "off",
    "typescript/require-array-sort-compare": "off",
    "typescript/restrict-template-expressions": "off",
    "typescript/unbound-method": "off",
    "react/no-children-prop": "off",

    // Tests place assertions inside vi.waitFor / Promise callbacks, which the
    // plugin reports as standalone expects even though they run within a test.
    "vitest/no-standalone-expect": "off",
    "vitest/require-mock-type-parameters": "off",

    // anti-slop
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },

  // Architecture boundary: client-side packages consume domain schemas, never
  // DB internals. Server-side code (apps/server, packages/auth, integrations)
  // is exempt because it legitimately talks to Postgres.
  overrides: [
    {
      files: [
        "apps/web/src/**",
        "apps/public-feature-board/src/**",
        "packages/post-ui/src/**",
        "packages/web-shared/src/**",
        "packages/ui/src/**",
        "packages/feedback-widget/src/**",
        "packages/sdk/src/**",
      ],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@feeblo/db", "@feeblo/db/**"],
                message:
                  "Client code must not import @feeblo/db directly. Import schemas/vocabulary from @feeblo/domain instead.",
              },
            ],
          },
        ],
      },
    },
  ],
  options: {
    // Revisit once Oxlint's tsgolint path can integrate with @effect/tsgo diagnostics.
    typeAware: false,
    typeCheck: false,
  },
});
