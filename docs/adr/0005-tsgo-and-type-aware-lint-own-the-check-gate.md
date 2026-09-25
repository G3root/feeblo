# ADR 0005: TypeScript 7 and type-aware Oxlint own the check gate

## Decision

The workspace compiles with TypeScript `7.0.2` and lints with Oxlint `1.82.0` in type-aware mode. `@effect/tsgo@0.45.0` patches both tools in `prepare`, and Oxlint — not `tsc` — is the only surface that reports Effect diagnostics: `packages/config/tsconfig.base.json` sets `diagnostics: false` on the language-service plugin and `oxlint.config.ts` extends `@effect/tsgo/oxlint-presets/recommended`. Every package declares `typecheck: tsc --noEmit`, and `pnpm check` (`turbo run check`) runs those together with the type-aware lint pass and the formatter check. CI runs it as the `checks` job.

## Why

Nothing typechecked the workspace. There was no `typecheck` script in any package, no `typecheck` task in `turbo.json`, and no lint or typecheck step in CI: `apps/web` builds through Vite, `apps/server` through Rolldown, and neither reads types. `packages/domain` compounded this by declaring `composite`, `declaration`, and `outDir` with nothing to emit them, so its `exports` map pointed at source while a latent `TS7056` sat in `rpc-router.ts` waiting for the first tool that asked tsc to serialize a declaration. TypeScript was an editor feature, not a gate.

Turning it on is cheap now. All 26 packages typecheck clean under TypeScript 7, and the first run surfaced exactly three real problems: the `TS7056` above and two tsconfigs (`packages/sdk`, `packages/feedback-widget`) that declared `outDir`/`declaration` without `rootDir`. That is the whole migration.

Type-aware linting had been disabled deliberately — the config carried "revisit once Oxlint's tsgolint path can integrate with `@effect/tsgo` diagnostics" next to `typeAware: false`. That integration is what `@effect/tsgo` now is: the patch wires the `effecttsgo` plugin into Oxlint, and `oxlint-tsgolint` provides the type information. The cost of the old setting was 17 `typescript/*` rules switched off, including `no-floating-promises`, which is the highest-value rule in an async codebase.

Splitting responsibility between the two tools keeps each one honest. `tsc` owns types and stays fast enough to cache per package; Oxlint owns Effect rules, where per-rule severity, file-scoped overrides, and a single cached run are easier to reason about than a tsconfig severity map. Running the Effect rules in both places would report every finding twice.

## Consequences

Every Effect rule now lives in `oxlint.config.ts`, and changing a diagnostic severity is a config edit rather than a tsconfig edit. The `effecttsgo` rules that fire on usage anywhere in a file — `async-function`, `global-date`, `process-env`, `global-console` — are `off` with written reasons, because this repo deliberately keeps those behaviors outside Effect at its boundaries (Playwright specs, TanStack Start server functions, better-auth plugins, the standalone widget, Node scripts). Their `-in-effect` siblings stay on, and those are the ones that describe a defect.

That distinction is the thing to know when reading the warning count. The bare variants fire in files with no Effect context at all, so their totals overstate the problem badly: `new-promise` (21) is Storybook mocks, a framework-agnostic editor, and Playwright specs; `global-timers` (12) is Storybook, the embeddable SDK, a PostHog provider, and a clipboard hook; `schema-sync` (26) is almost entirely `decodeUnknownSync` in test files, where a throw is what you want; `any-unknown-in-error-context` (43) is 30 test files plus HTTP router plumbing where the `unknown` is inference, not a decision. None of those should be churned to satisfy a rule whose advice does not apply. What is genuinely actionable, in order:

1. `global-date-in-effect` (433, concentrated in `email-outbox`, `post`, `workspace`, `db`). `new Date()` inside Effect bypasses `Clock`, so those services cannot be tested against `TestClock`. This is the largest real defect in the codebase.
2. `typescript/no-floating-promises` (48, mostly React event handlers) — a floating promise in a handler is an unhandled rejection.
3. `strict-effect-provide` (50) and `any-unknown-in-error-context` (the 7 production sites).
4. `global-console-in-effect` (26) is 24/26 in `packages/db/seed.ts`, a human-facing CLI where `console.log` prints the output an operator expects; `Effect.log` would add fiber and timestamp noise. Leave it unless that script becomes machine-read.

Each should be fixed and then flipped to `error`. None should be silenced.

Tests keep one documented exception to the manual-runtime ban: `packages/auth/src/api-key.test.ts` builds `ManagedRuntime` values at module scope, because it shares one PGlite database across the file and passes it to the better-auth adapter as a plain value rather than inside an Effect. Its `oxlint-disable` carries the reason inline. Every other test file uses `it.effect`/`it.layer`, enforced by `tools/oxlint/effect-tests`.

`extends-native-error` stays on as a warning rather than being fixed: `RpcError` in `packages/web-shared` and `EmbedError` in `packages/sdk` are deliberately plain `Error` subclasses that never enter an Effect failure channel, and the SDK one must not pull `effect/Schema` into the embeddable bundle.

A dependency bump now has a version contract. `@effect/tsgo` names the TypeScript, Oxlint, and `oxlint-tsgolint` versions it supports; `effect-tsgo patch` validates them and refuses to patch a mismatch, so these four pins move together or not at all.
