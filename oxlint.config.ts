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
    // Vitest's `expect(actual, message?)` accepts an optional message (unlike
    // Jest's), and these suites pass the loop's `METHOD path` or query as that
    // message so a failure says which case failed. The rule's Jest-era default
    // of one argument reports those messages as invalid.
    "vitest/valid-expect": ["warn", { maxArgs: 2 }],

    // All 127 findings are the same false positive on the repo's dominant
    // idiom. `return yield* new TaggedError(...)` fails without producing a
    // value, and `return yield* Effect.void` produces none, but the rule reads
    // the `yield*` expression as a value and the generator's fall-through as
    // `undefined`, so it reports every void-returning `Effect.gen` that guards
    // with a typed error. It is equally wrong on React effect callbacks, whose
    // `void | Destructor` return is the platform's contract. Satisfying it
    // would mean adding a trailing `return yield* Effect.void` to 127 bodies
    // and an explicit `return undefined` to every early React exit; ADR 0005's
    // rule is not to churn code to satisfy a rule whose advice does not apply.
    "typescript/consistent-return": "off",

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

    // ---------------------------------------------------------------------
    // The rest of the boundary pattern above, extended to the plain halves
    // whose `-in-effect` siblings are `error` below. Each one fires only on
    // code this repo deliberately keeps outside Effect: browser components,
    // Playwright specs, test setup and fixtures, the standalone widget/SDK,
    // Node scripts and build configs. The defect is doing the thing inside a
    // fiber tree, where it bypasses the service the runtime substitutes in
    // tests, and that half stays `error`. ADR 0005 records why these sites are
    // not churned to satisfy a rule whose advice does not apply.
    // ---------------------------------------------------------------------
    // `crypto.randomUUID()`, `fetch`, `Math.random` and `setTimeout` are the
    // browser's own APIs in React components and the embeddable widget, and
    // Playwright/setup code has no Effect runtime to read them through.
    "effecttsgo/crypto-random-uuid": "off",
    "effecttsgo/global-fetch": "off",
    "effecttsgo/global-random": "off",
    "effecttsgo/global-timers": "off",
    // 54 findings, all `Schema.decodeUnknownSync` in tests (where a throw is
    // the assertion) or in the widget's Effect-free decode helpers. The
    // `schema-sync-in-effect` sibling stays `error`.
    "effecttsgo/schema-sync": "off",
    // Storybook mocks, Playwright specs, test servers, browser code, and the
    // one deliberate wall-clock race in `packages/db`'s PGlite close. There is
    // no `-in-effect` sibling; the Effect-native Promise rules
    // (`promise-in-effect-success`, `lazy-promise-in-effect-sync`) stay on.
    "effecttsgo/new-promise": "off",
    // Node builtins at the boundaries: `node:crypto` HMAC/RSA/timing-safe
    // comparisons that Effect's `Crypto` service does not cover, `node:http`
    // for the server's own `createServer`, and test/script/config files.
    "effecttsgo/node-builtin-import": "off",
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

    // The three `prefer-effect-*` rules arrived with `@effect/tsgo@0.56` and
    // report 2,514 findings between them, all of one kind: `effect/Array`,
    // `effect/String` and `effect/Record` re-export functions that behave
    // exactly like the native method they replace. Nothing is defective at any
    // of those sites, and around a thousand of them are in browser bundles,
    // Playwright specs, the published `@feeblo/sdk` and the embeddable widget,
    // where importing `effect/*` to call `.trim()` is bundle weight for no
    // behavioural change — the same reason ADR 0005 keeps `effect/Schema` out
    // of that bundle. One of them is not even a drop-in: `Array.find` returns
    // `undefined` while `Array.findFirst` returns `Option`, so "prefer" there
    // is a rewrite with a different return type at every one of its sites.
    // Leaving 2,514 warnings would train reviewers to skim the report, which
    // is the argument this file already makes for `unstable-api-usage`.
    "effecttsgo/prefer-effect-array": "off",
    "effecttsgo/prefer-effect-record": "off",
    "effecttsgo/prefer-effect-string": "off",

    // The 127 findings are all `Schema.TaggedError`, and the brand the rule asks
    // for would be a symbol nothing matches on. The rule's concern is that
    // "TypeScript may accept structurally compatible values where this class
    // instance type is expected" — but a tagged error already carries `_tag` as
    // a required unique literal, so two errors with identical fields are not
    // assignable to each other. Checked with a pair of one-field errors: tsc
    // rejects both directions on `_tag` alone. `_tag` is the brand. The 127 are
    // the per-module error vocabularies (`post/errors.ts`,
    // `data-transfer/errors.ts`, `public-api/errors.ts`) plus the integration
    // adapters, and ADR 0005's pattern is to brand a type that needs
    // discriminating — these are already discriminated.
    "effecttsgo/schema-class-missing-brand": "off",

    // The first rung of ADR 0005's ratchet, and now clear everywhere except
    // `packages/db/seed.ts`. `new Date()` inside Effect bypasses `Clock`, so
    // the rule is an error for every new way to write it; the seed script's
    // snapshot fixtures are pinned to `warn` in the override below.
    "effecttsgo/global-date-in-effect": "error",

    // ADR 0005's console rung. The 26 findings were two human-facing CLIs,
    // whose `console.log` is the output an operator reads; `Effect.log` would
    // add fiber ids and timestamps to it. Those two files keep a `warn`
    // override below, and every other file is `error`, so a service that logs
    // to the console instead of through its `Logger` fails the gate.
    "effecttsgo/global-console-in-effect": "error",

    // Cleared by composing every layer where its scope lives: production
    // surfaces capture their collaborators at group construction, and tests
    // use `layer`/`it.layer` fixtures (or build the one per-call layer in the
    // test's own scope). The one true entry point
    // (`apps/server/src/app/program.ts`) carries a targeted disable with its
    // reason, so a new provide-inside-a-request now fails the gate instead of
    // warning.
    "effecttsgo/strict-effect-provide": "error",

    // The rest of ADR 0005's ratchet that is already clear. Each rule below is
    // `warn` in the two extended presets and reports zero findings in this
    // tree, so `error` costs nothing today and makes the first violation fail
    // the gate instead of joining a list nobody reads. All but the last two
    // are the `-in-effect` half of the boundary pattern above: global fetch,
    // timers, `Math.random`, `crypto.randomUUID`, `process.env`, sync Schema
    // decoding and a hand-built `AbortController` are ordinary at the edges
    // and a defect inside a fiber tree, where they bypass the service the
    // runtime substitutes in tests. `instance-of-schema` is the decoded-error
    // rule AGENTS.md names — `instanceof` answers `false` for a decoded value
    // that carries `_tag` with no prototype, so the branch silently takes its
    // fallback and `Schema.is` is the only correct match. `leaking-requirements`
    // keeps a service's implementation type out of its method signatures.
    // `any-unknown-in-error-context` was the third rung, and it is clear: zero
    // findings after Effect `4.0.5` turned `Crypto.randomUUIDv4`/
    // `randomUUIDv7` into methods, so every `crypto.randomUUIDv4.pipe(...)`
    // site required `never` instead of `unknown` and the `unknown` stopped
    // flowing outward. `error` costs nothing today and keeps an `unknown` from
    // re-entering a failure or requirement channel unnoticed.
    "effecttsgo/any-unknown-in-error-context": "error",
    "effecttsgo/leaking-requirements": "error",
    "effecttsgo/abort-controller-in-effect": "error",
    "effecttsgo/crypto-random-uuid-in-effect": "error",
    "effecttsgo/global-fetch-in-effect": "error",
    "effecttsgo/global-random-in-effect": "error",
    "effecttsgo/global-timers-in-effect": "error",
    "effecttsgo/instance-of-schema": "error",
    "effecttsgo/process-env-in-effect": "error",
    "effecttsgo/schema-sync-in-effect": "error",

    // ADR 0005's floating-promise rung. A promise started in an event handler,
    // an effect body or a React callback and never awaited is an unhandled
    // rejection, and the failure surfaces somewhere else. Every site the rule
    // reported now marks the wait it chose not to take with `void` (the pattern
    // the tree already used at 27 other sites), returns it, or awaits it; from
    // here a new float fails the gate instead of warning.
    "typescript/no-floating-promises": "error",

    // Arrived with the `@effect/tsgo@0.56` / `oxlint-tsgolint@7.0.2004` train and
    // reports two findings, both deliberate: a `Schema.Struct({})` whose
    // `Schema.Type` is `{}` because the thing it describes genuinely has no
    // configuration. Those two files are `off` in the override below, and the
    // rule is `error` here so a *new* empty struct — which usually means a
    // schema that silently lost its fields — fails the gate.
    "typescript/no-generated-empty-object-type": "error",

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
      // Human-facing CLIs, not services: `seed.ts` prints its progress as it
      // goes, and `nuke.ts` prints what it removes. `Effect.log` would add
      // fiber ids and timestamps to output a person reads directly. ADR 0005
      // says to leave the code as it is, so the rule is off for exactly these
      // two files and stays `error` everywhere else.
      files: ["packages/db/seed.ts", "packages/db/nuke.ts"],
      rules: {
        "effecttsgo/global-console-in-effect": "off",
      },
    },
    {
      // ADR 0005's date rung excepts only `seed.ts`, whose fixture timestamps
      // for the rows it inserts are the remaining findings and are deliberately
      // left. `nuke.ts` constructs no dates, so it stays under the global
      // `error`: a new `new Date()` there fails the gate instead of warning.
      files: ["packages/db/seed.ts"],
      rules: {
        "effecttsgo/global-date-in-effect": "off",
      },
    },
    {
      // Tests build the exact wire bytes a provider's signature covers
      // (`JSON.stringify` of the body) and assert what a serialized error
      // contains. That is the input under test, not a decode boundary that
      // should go through a Schema codec; production code is covered by the
      // rule, and the two production findings it had were fixed.
      files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
      rules: {
        "effecttsgo/prefer-schema-over-json": "off",
      },
    },
    {
      // `RpcError` and `EmbedError` are deliberately plain `Error` subclasses
      // that never enter an Effect failure channel, and the SDK one must not
      // pull `effect/Schema` into the embeddable bundle (ADR 0005). The rule
      // stays `error` everywhere else, so a new untagged error in a service
      // fails the gate.
      files: [
        "packages/sdk/src/errors.ts",
        "packages/web-shared/src/lib/rpc-error.ts",
      ],
      rules: {
        "effecttsgo/extends-native-error": "off",
      },
    },
    {
      // `DiscordConnectionConfiguration` and `SlackConnectionConfiguration` are
      // deliberately `Schema.Struct({})`: a connection carries no settings of
      // its own and the destination channel is chosen per route, so the schema
      // exists to state "nothing to configure here" rather than to hold fields.
      // Its `Schema.Type` is therefore `{}`, which is exactly what the rule
      // reports. Individually named files rather than a glob, so the exception
      // cannot spread to the next empty struct someone adds.
      files: [
        "integrations/discord/src/discord-manifest.ts",
        "integrations/slack/src/slack-manifest.ts",
      ],
      rules: {
        "typescript/no-generated-empty-object-type": "off",
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
      // E2E specs observe the product through its HTTP API and UI. Importing an
      // application module would let a test assert against the implementation it
      // is supposed to exercise, and PGlite must stay in the server harness
      // (`e2e/servers.ts` and `e2e/scripts/migrate-pglite.ts`). `@feeblo/utils`
      // and `@feeblo/permissions` are plain vocabularies, not product internals.
      files: ["e2e/tests/**", "e2e/helpers/**", "e2e/page-objects/**"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "@feeblo/domain",
                  "@feeblo/domain/**",
                  "@feeblo/db",
                  "@feeblo/db/**",
                  "@feeblo/auth",
                  "@feeblo/auth/**",
                  "../../packages/**",
                  "../../apps/**",
                  "../../integrations/**",
                ],
                message:
                  "E2E specs must drive the product through its API and UI, not import application modules.",
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
