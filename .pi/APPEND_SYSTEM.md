# Project context

Pi appends this file to its system prompt for sessions in this repo. It is the short version of `AGENTS.md`; when the two disagree, `AGENTS.md` wins.

- **Repo law** is `AGENTS.md`. Read it before substantial work, and read its "Boundaries and sign-off" section before touching dependencies, auth, billing, migrations, or CI.
- **Vocabulary** is `CONTEXT.md`. **Decisions** are `docs/adr/` — read `0002` before moving anything between `domain` and `integrations/*`, and `0004` before touching the Public API.
- **The gate is `pnpm check`**: every package's `tsc --noEmit`, then type-aware Oxlint, then the formatter check. It needs no database, no build output, and no env file. CI runs it as the `checks` job. There is no commit hook, so nothing catches a bad commit until CI does — run it yourself first.
- **Effect diagnostics are Oxlint's job, not tsc's.** `effecttsgo/*` rules live in `oxlint.config.ts`; the tsconfig sets `diagnostics: false` so nothing is reported twice. Severity changes go in the Oxlint config.
- **Tests use `@effect/vitest`.** `Effect.run*` and `ManagedRuntime.make` in a test file are a lint error. `it.effect` gives the test a `Scope`, the `TestClock`, and layer memoization.
- **Read `node_modules/effect/AGENTS.md` before writing Effect code.** It ships with the installed version, so it is never stale, and it is a better reference than anything in this repo.
- **Match errors by tag, not prototype** (`Schema.is`, `Predicate.isTagged`). A decoded error has no prototype and `instanceof` silently answers `false`.
- **Active constraint:** `effect`, `@effect/platform-node`, `@effect/vitest`, `@effect/sql-*`, `@effect/atom-*` and `@effect/ai-*` share one release train (all `4.0.0`); TypeScript, Oxlint, `oxlint-tsgolint`, and `@effect/tsgo` share another and `effect-tsgo patch` refuses a mismatch. Bump a train, not a package. `@effect/tsgo` also embeds the Effect module paths its rules match on, so it must be new enough for the `effect` version in the catalog — otherwise the `effecttsgo/*` diagnostics silently stop firing.
- **`oxlint.config.ts` extends two tsgo presets, `recommended` and `effect-native`, and both are load-bearing.** tsgo 0.46 moved twenty `global-*`/`process-env`/`schema-sync` rules into the opt-in preset; extending only `recommended` silently drops `global-date-in-effect`. Review a tsgo bump by diffing presets, not by watching the gate go green.
- **The tree is often edited concurrently.** Check `git status` before you stage, and never sweep files you did not change into a commit.
- **`effecttsgo/global-date-in-effect` is `error` everywhere except `packages/db/seed.ts`, whose 22 findings are pinned to `warn`.** Every runtime service and test file reads time through `Clock`/`DateTime`; the seed script's fixture timestamps are deliberately left, since it is a human-facing CLI. The rest of the ratchet order is in `docs/adr/0005`.
