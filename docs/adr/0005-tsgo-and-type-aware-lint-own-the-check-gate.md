# ADR 0005: TypeScript 7 and type-aware Oxlint own the check gate

## Decision

The workspace compiles with TypeScript `7.0.2` and lints with Oxlint `1.82.0` in type-aware mode. `@effect/tsgo@0.45.0` patches both tools in `prepare`, and Oxlint — not `tsc` — is the only surface that reports Effect diagnostics: `packages/config/tsconfig.base.json` sets `diagnostics: false` on the language-service plugin and `oxlint.config.ts` extends `@effect/tsgo/oxlint-presets/recommended`. Every package declares `typecheck: tsc --noEmit`, and `pnpm check` (`turbo run check`) runs those together with the type-aware lint pass and the formatter check. CI runs it as the `checks` job.

## Why

Nothing typechecked the workspace. There was no `typecheck` script in any package, no `typecheck` task in `turbo.json`, and no lint or typecheck step in CI: `apps/web` builds through Vite, `apps/server` through Rolldown, and neither reads types. `packages/domain` compounded this by declaring `composite`, `declaration`, and `outDir` with nothing to emit them, so its `exports` map pointed at source while a latent `TS7056` sat in `rpc-router.ts` waiting for the first tool that asked tsc to serialize a declaration. TypeScript was an editor feature, not a gate.

Turning it on is cheap now. All 26 packages typecheck clean under TypeScript 7, and the first run surfaced exactly three real problems: the `TS7056` above and two tsconfigs (`packages/sdk`, `packages/feedback-widget`) that declared `outDir`/`declaration` without `rootDir`. That is the whole migration.

Type-aware linting had been disabled deliberately — the config carried "revisit once Oxlint's tsgolint path can integrate with `@effect/tsgo` diagnostics" next to `typeAware: false`. That integration is what `@effect/tsgo` now is: the patch wires the `effecttsgo` plugin into Oxlint, and `oxlint-tsgolint` provides the type information. The cost of the old setting was 17 `typescript/*` rules switched off, including `no-floating-promises`, which is the highest-value rule in an async codebase.

Splitting responsibility between the two tools keeps each one honest. `tsc` owns types and stays fast enough to cache per package; Oxlint owns Effect rules, where per-rule severity, file-scoped overrides, and a single cached run are easier to reason about than a tsconfig severity map. Running the Effect rules in both places would report every finding twice.

## Consequences

Every Effect rule now lives in `oxlint.config.ts`, and `docs`-level changes to a diagnostic severity are config edits rather than tsconfig edits. Four `effecttsgo/*` rules are `off` with written reasons — `async-function`, `global-date`, `process-env`, `global-console` — because this repo deliberately keeps those behaviors outside Effect at its boundaries (Playwright specs, TanStack Start server functions, better-auth plugins, the standalone widget, Node scripts); their `-in-effect` siblings stay on, which is where the hazard actually costs testability.

Two gates are now red on tracked code until ratcheted, both advisory rather than blocking: `typescript/no-floating-promises` (47 findings, mostly React event handlers) and `effecttsgo/global-date-in-effect` (421, concentrated in `email-outbox`, `post`, `workspace`, `db`). Both should be fixed and flipped to `error`; neither should be silenced.

Tests keep one documented exception to the manual-runtime ban: `packages/auth/src/api-key.test.ts` builds `ManagedRuntime` values at module scope, because it shares one PGlite database across the file and passes it to the better-auth adapter as a plain value rather than inside an Effect. Its `oxlint-disable` carries the reason inline. Every other test file uses `it.effect`/`it.layer`, enforced by `tools/oxlint/effect-tests`.

A dependency bump now has a version contract. `@effect/tsgo` names the TypeScript, Oxlint, and `oxlint-tsgolint` versions it supports; `effect-tsgo patch` validates them and refuses to patch a mismatch, so these four pins move together or not at all.
