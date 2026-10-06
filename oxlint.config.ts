import { effectNative, recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

/**
 * Effect diagnostics live here, not in `tsc`.
 *
 * `@effect/tsgo` patches both `tsc` and Oxlint. Running the Effect rules in
 * both places reports every finding twice, so `packages/config/tsconfig.base.json`
 * sets `diagnostics: false` and Oxlint owns them: one surface, one severity
 * per rule, cached, and fast enough to run on every commit.
 *
 * Both presets are extended on purpose. `@effect/tsgo@0.46` moved the twenty
 * `global-*`, `crypto-*`, `process-env`, `new-promise`, `schema-sync` and
 * `instance-of-schema` rules out of `recommended` and into the opt-in
 * `effect-native` preset. Extending only `recommended` would therefore have
 * dropped `global-date-in-effect` — the defect ADR 0005 ranks first, and the
 * rule this file's `off` entries below are written against — without a single
 * test or type error to say so. The two presets together are exactly the rule
 * set `0.45.0`'s `recommended` carried, plus the three rules 0.47 added.
 */
export default defineConfig({
  extends: [recommended, effectNative],
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
    // 928 findings, and every one of them is the same non-defect. Effect 4.0
    // moved `http`, `http-api`, `rpc`, `sql`, `persistence`, `reactivity` and
    // `workflow` out of `effect/unstable/*` into `effect/*` while keeping them
    // `@stability unstable`, so the rule now fires on the imports this repo is
    // built out of: `HttpApi`, `RpcGroup`, `Atom`, `PersistedQueue`. There is no
    // stable alternative to move to — an Effect HTTP or RPC server has to use
    // these — so the warning says "this dependency may break in a minor" about
    // the dependency, not about this code. Flipping it to `error` would mean
    // either suppressing it at every call site or freezing the Effect version,
    // and leaving it as 928 warnings trains reviewers to skim the report. The
    // upgrade itself is the control: the catalog pin is what decides when these
    // APIs move.
    "effecttsgo/unstable-api-usage": "off",

    // The first rung of ADR 0005's ratchet, and now clear everywhere except
    // `packages/db/seed.ts`. `new Date()` inside Effect bypasses `Clock`, so
    // the rule is an error for every new way to write it; the seed script's
    // snapshot fixtures are pinned to `warn` in the override below.
    "effecttsgo/global-date-in-effect": "error",

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
  // DB internals or another package's `src/` path. The export map is the
  // contract; a deep import compiles today and breaks the moment a file moves,
  // and it lets client code reach modules the package never meant to publish.
  // Server-side code (apps/server, packages/auth, integrations) is exempt from
  // the DB half because it legitimately talks to Postgres.
  overrides: [
    {
      // A human-facing CLI, not a service: `seed.ts` builds fixture timestamps
      // for the rows it inserts, and ADR 0005 leaves those 22 sites as the
      // rule's only remaining findings. Every other file is `error`.
      files: ["packages/db/seed.ts"],
      rules: {
        "effecttsgo/global-date-in-effect": "warn",
      },
    },
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
              {
                group: ["@feeblo/domain/src", "@feeblo/domain/src/**"],
                message:
                  "Client code must import @feeblo/domain through its export map (e.g. @feeblo/domain/comments/schema), never from src/.",
              },
            ],
          },
        ],
      },
    },
    {
      // Architecture boundary for the Public API's shared root (see ADR 0004).
      // Response schemas from the dashboard and the public portal carry
      // internal actor identifiers (`creatorId`, `creatorMemberId`) that must
      // never reach an API key's owner, and the session middleware would let a
      // machine credential resolve into a member session. The named modules are
      // the ones ADR 0004 calls out; a bare `**/post/schema` also matched the
      // Public API's own contract, and `../*/schema` matched unrelated modules
      // like `api-key/schema`.
      files: ["packages/domain/src/public-api/**"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "../post/schema",
                  "../widget/schema",
                  "../public-actor",
                  "../session-middleware",
                  "@feeblo/domain/post/schema",
                  "@feeblo/domain/widget/schema",
                  "@feeblo/domain/public-actor",
                  "@feeblo/domain/session-middleware",
                ],
                message:
                  "The Public API must not import dashboard or portal response schemas (they carry internal actor identifiers) or the session middleware (a machine key must never resolve into a session). Define DTOs in the feature's public-api schema and use the key seam from auth-handler.",
              },
            ],
          },
        ],
      },
    },
    {
      // The same boundary for a feature's colocated public slice. From
      // `<feature>/public-api/`, the feature's own dashboard schema is
      // `../schema` and another feature's is `../../<feature>/schema`; banning
      // every `../schema` here is deliberate — the public DTOs are hand-written
      // and must not borrow a dashboard row shape.
      files: ["packages/domain/src/*/public-api/**"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "../schema",
                  "../../post/schema",
                  "../../widget/schema",
                  "../../public-actor",
                  "../../session-middleware",
                  "@feeblo/domain/post/schema",
                  "@feeblo/domain/widget/schema",
                  "@feeblo/domain/public-actor",
                  "@feeblo/domain/session-middleware",
                ],
                message:
                  "The Public API must not import dashboard or portal response schemas (they carry internal actor identifiers) or the session middleware (a machine key must never resolve into a session). Define DTOs in the feature's public-api schema and use the key seam from auth-handler.",
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
