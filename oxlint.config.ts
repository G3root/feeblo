import { recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

/**
 * Effect diagnostics live here, not in `tsc`.
 *
 * `@effect/tsgo` patches both `tsc` and Oxlint. Running the Effect rules in
 * both places reports every finding twice, so `packages/config/tsconfig.base.json`
 * sets `diagnostics: false` and Oxlint owns them: one surface, one severity
 * per rule, cached, and fast enough to run on every commit.
 */
export default defineConfig({
  extends: [recommended],
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
    "tools/oxlint/**",
  ],

  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "effect-tests", specifier: "./tools/oxlint/effect-tests/index.ts" },
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
    "react/no-children-prop": "off",

    // The rules below were disabled while `options.typeAware` was false, so they
    // could not run at all. Type-aware linting is on now; these three stay off,
    // each for a stated reason.
    "typescript/no-unsafe-type-assertion": "off",
    // 131 findings that are all the same non-defect: an explicit type argument
    // that matches the parameter's default. Pure style, no signal.
    "typescript/no-unnecessary-type-arguments": "off",
    // Off for an unsafe `--fix`, not for the rule's intent. In
    // `packages/permissions/src/permissions.ts` it judged the assertion on
    // `${resource}.${action}` unnecessary and removed it, which widened the
    // result to `string[]` and broke `tsc` — the autofix workflow then committed
    // that break. It also reported 92 sites repo-wide, so the fix/break cycle
    // was not going to end on its own. Re-enable only if the fixer is fixed.
    "typescript/no-unnecessary-type-assertion": "off",

    // Tests place assertions inside vi.waitFor / Promise callbacks, which the
    // plugin reports as standalone expects even though they run within a test.
    "vitest/no-standalone-expect": "off",
    "vitest/require-mock-type-parameters": "off",

    // ---------------------------------------------------------------------
    // Effect diagnostics that do not describe a defect in this codebase.
    //
    // Each `-in-effect` sibling stays on: they cover the same hazard inside
    // Effect code, which is where it actually costs testability. The plain
    // rule fires on the boundaries this repo deliberately keeps outside
    // Effect (Playwright specs, TanStack Start server functions, better-auth
    // plugins, the standalone widget/SDK, Node scripts).
    // ---------------------------------------------------------------------

    // 829 findings, almost all in client components, browser-side React, and
    // Playwright specs where `async` is the platform's own API.
    "effecttsgo/async-function": "off",
    // `new Date()` outside Effect is ordinary work (Drizzle schema defaults,
    // client formatting). The defect is `new Date()` *inside* Effect, which
    // `global-date-in-effect` reports.
    "effecttsgo/global-date": "off",
    // Environment is read once at composition roots, migrations, and scripts.
    // Reading it inside an Effect service is the defect, and is reported.
    "effecttsgo/process-env": "off",
    // The widget, the SDK, and CLI entry points log to the console on purpose;
    // they have no logger to route through.
    "effecttsgo/global-console": "off",

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
      // Tests run Effects through `@effect/vitest`, never by hand.
      files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
      rules: {
        "effect-tests/no-manual-effect-runtime-in-tests": "error",
      },
    },
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
    {
      // Architecture boundary for the Public API (see ADR 0004). Response
      // schemas from the dashboard and the public portal carry internal actor
      // identifiers (`creatorId`, `creatorMemberId`) that must never reach an
      // API key's owner, and the session middleware would let a machine
      // credential resolve into a member session. The Public API owns its DTOs
      // in `public-api/schema.ts` and reads the key seam from `auth-handler`.
      files: ["packages/domain/src/public-api/**"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/post/schema",
                  "**/widget/schema",
                  "**/public-actor",
                  "**/session-middleware",
                  "@feeblo/domain/post/schema",
                  "@feeblo/domain/widget/schema",
                  "@feeblo/domain/public-actor",
                  "@feeblo/domain/session-middleware",
                ],
                message:
                  "The Public API must not import dashboard or portal response schemas (they carry internal actor identifiers) or the session middleware (a machine key must never resolve into a session). Define DTOs in public-api/schema.ts and use the key seam from auth-handler.",
              },
            ],
          },
        ],
      },
    },
  ],

  options: {
    // Type-aware rules run through `oxlint-tsgolint`, which `@effect/tsgo`
    // patches so the `effecttsgo/*` rules resolve. tsc still owns plain type
    // checking; `typeCheck` stays off so diagnostics are not reported twice.
    typeAware: true,
    typeCheck: false,
  },
});
