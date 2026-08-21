# SDK releases

Two packages in this repository publish to npm:

| Package | Directory | Release tag | Consumes |
| --- | --- | --- | --- |
| `@feeblo/sdk` | `packages/sdk` | `sdk@X.Y.Z` | — |
| `@feeblo/sdk-react` | `packages/sdk-react` | `sdk-react@X.Y.Z` | `@feeblo/sdk` |

Releases are triggered by publishing a GitHub Release whose tag name starts with the package prefix. The [`publish-sdks.yml`](../.github/workflows/publish-sdks.yml) workflow picks the matching job, verifies the tag against `package.json`, builds through turbo, and publishes with pnpm.

## Release runbook

1. **Bump versions.** Update `version` in the `package.json` of every package that changed.
2. **Sync the dependency pin.** If `@feeblo/sdk` changed, release `@feeblo/sdk-react` in the same pass: its dependency is declared as `workspace:*`, which pnpm publishes as an **exact version pin** (for example `0.0.2`), so a new core version is only installable alongside the bindings after they are republished. Consumers resolve the bindings against this pinned core, which keeps the singleton SDK to a single copy per install.
3. **Check CI is green on `main`.** The publish job builds but does not re-run tests; tests gate merges through [`ci.yml`](../.github/workflows/ci.yml).
4. **Cut GitHub Releases, SDK first when both changed.** Create one release per package with tags `sdk@X.Y.Z` and/or `sdk-react@X.Y.Z`. Order matters: until the new core is on the registry, a freshly published `@feeblo/sdk-react` that depends on it cannot be installed by consumers.
5. **Watch the workflow run.** Each job fails loudly if the tag does not match the package version, so a mistyped tag never reaches npm.
6. **Smoke-check the result.** After both jobs finish: `pnpm view @feeblo/sdk version`, `pnpm view @feeblo/sdk-react dependencies` (the dependency must be the exact released core version, like `0.0.2`, never `workspace:*`), and ideally an install from a scratch project.

## Why the workflow publishes with pnpm

`sdk-react` declares its dependency as `"@feeblo/sdk": "workspace:*"`. That protocol is a pnpm workspace feature: `pnpm publish` replaces it with the exact published version of the core inside the tarball (a `workspace:^` declaration would become a caret range instead). `npm publish` does not understand the protocol and would ship an uninstallable range to the registry. The core SDK currently has no dependencies, so it would survive either client — both jobs still use `pnpm publish` for uniformity.

Builds go through `pnpm exec turbo build --filter=<package>` rather than a direct package script because turbo's `^build` graph builds workspace dependencies first. This matters for `sdk-react`: its declaration build resolves `@feeblo/sdk` types from the SDK's `dist` output.

Both jobs request `id-token: write` and set `NPM_CONFIG_PROVENANCE=true`, so npm records provenance attestation linking each tarball to its repository and build. The Sigstore endpoints in the runner's allowlist serve that attestation flow.

## Versioning policy

Versions are independent per package; there is no lockstep requirement. In practice most releases touch the core SDK alone, and the React bindings follow only when their adapter surface changes — but because the bindings pin the core to an exact version, every `@feeblo/sdk` release should be paired with an `@feeblo/sdk-react` release so consumers can adopt the new core through the bindings. Breaking changes to the widget's public API should ship as a major bump of `@feeblo/sdk` plus a matching release of `@feeblo/sdk-react`.

## Adding another published package

1. Give the package the standard publishable shape: `private: false`, `publishConfig.access: "public"`, a `files` allowlist, and an `exports` map with `types`.
2. Add a job to `publish-sdks.yml` with the new tag prefix, following the existing pair.
3. Add a row to the table above.

## Changesets upgrade path

If release cadence grows to the point where hand-bumping versions and dependency ranges becomes error-prone, adopt Changesets: pull requests carry changeset files, a bot maintains a Version Packages PR that bumps versions, changelogs, and dependent ranges together, and merging it publishes every changed package in topological order. Note that this replaces the tag-triggered flow entirely — retire `publish-sdks.yml` at the same time rather than running both.
