# Toolchain trains

Three sets of packages in this repo are versioned as trains rather than individually. `check-toolchain.ts` reads the catalog, the manifests and the workspace overrides and fails the gate when a train diverges, so a bad bump surfaces as a failed check instead of as diagnostics that quietly stopped firing.

## The Effect train

`effect`, `@effect/platform-node`, `@effect/vitest`, `@effect/sql-pg`, `@effect/sql-pglite`, `@effect/atom-react` and `@effect/ai-openai` share one version and move together. Every `@effect/*` spec in a manifest is `catalog:`; `@effect/tsgo` is exempt because it versions itself.

The catalog also pins `@electric-sql/pglite`. `@effect/sql-pglite` takes it as a direct dependency where 4.0.5 took it as a peer, and two copies give `drizzle({ client })` two structurally different `PGlite` classes, so it stops compiling even though both are PGlite.

4.1 replaced the single `effect/Crypto` service with the `effect/crypto/*` family (`SecureRandom`, `Digest`, `Aead`, `Signature`, …), and split `effect/sql`'s `SqlClient` into `Base` plus `SqlClient`. A driver client no longer extends the generic service, so a layer that builds one of two drivers has to name `SqlClient` as its success type itself.

## The compiler and lint train

`tsrs` `0.25.0-ts7.1.0-beta`, `oxlint` `1.94.0`, `@oxlint/plugins` `1.94.0` and `@effect/tsgo` `0.70.0` move together, or the gate fails. `pnpm lint` is what enforces the pairing: `effect-tsgo --tsrs-lint oxlint` preloads the Effect-patched Oxlint binding and the patched `tsrs` linter of the versions `@effect/tsgo` names, and refuses an installed Oxlint outside that list before linting anything.

`@effect/tsgo` is not cosmetic. It embeds the module paths its rules match on, so the version has to know the Effect version in the catalog or the diagnostics go quiet: `0.45` keyed off `effect/unstable/*` and would have reported nothing once the `unstable` segment was dropped.

Each release names the compiler and Oxlint versions it supports, and that matrix is a ceiling, not a preference. A newer Oxlint or `tsrs` waits for the `@effect/tsgo` release that lists it. Read the matrix from the release that is installed, not from `npm view @effect/tsgo@<version> readme`: npm serves the newest publish's README, so a release whose README already lists a `tsrs` it does not accept is the normal case, and `0.67.3`'s own `patch` refused the two versions its README named.

`--tsrs-lint` is `0.70.0`'s addition and the reason the train moved: the type-aware pass runs on `tsrs` instead of on `oxlint-tsgolint`, so that package is not a dependency at all any more, and `check-toolchain.ts` fails if it is declared again.

`tsrs` is a Rust port of TypeScript's compiler, and its version names the release it ports: `0.25.0-ts7.1.0-beta` is a port of `7.1.0-beta`. A `tsrs` bump is therefore also a compiler-behavior bump, and the port reproduces that release's diagnostics, including ones the previous compiler did not report. The `typescript` package appears in `node_modules` only because `@tanstack/db`, `msw` and the Paraglide toolchain peer on it. No workspace package depends on it and the catalog must not pin it, or the two compilers become a second source of truth. `tsrs` is the binary in every `typecheck` script and in the SDKs' declaration build.

## The publish delay

`minimumReleaseAge: 1440` in `pnpm-workspace.yaml` refuses a version published in the last day. A reviewed release that has to land sooner is named under `minimumReleaseAgeExclude` with its exact version and a reason, never with a bare package name, and the entry is dropped once the release is a day old.

## Drizzle snapshots

`drizzle-orm` and `drizzle-kit` are one version, and the kit peers on that same release or neither runs. The committed snapshots in `packages/db/src/migrations` are format 9, which is a **diff chain**: each snapshot holds only its delta from its parent rather than the whole schema, so no snapshot is self-contained and the chain has to stay intact and ordered. `drizzle-kit up` produced that rewrite; it is one-way, and going back means regenerating. The ORM's own migrator, which deployments run through `packages/db-migrator`, never reads a snapshot, so this constrains tooling only.

## When Effect diagnostics go quiet

`prepare` runs `effect-tsgo patch --tsrs`, the one command that patches the installed `tsrs` binary with the Effect language service. The Oxlint side is not patched in `node_modules`; `--tsrs-lint` preloads `@effect/tsgo`'s own binding at lint time. `.vscode/settings.json` points the TypeScript 7 editor extension at `./node_modules/tsrs/tsdk`.

- Confirm `prepare` ran, or run `pnpm exec effect-tsgo patch --tsrs --force`.
- Confirm the linter went through `pnpm lint`. A bare `oxlint` reports the plain rules by design, and there is no script that skips the wrapper.
- If `pnpm install` reported `skipped because its hash matches the replacement`, the pnpm store is serving a previously patched binary. `unpatch` then `patch --force` fixes it. This does not happen on a fresh CI runner.
