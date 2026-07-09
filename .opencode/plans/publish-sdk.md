# Plan: Independent Docker releases + opt-in `@feeblo/sdk` npm publish

## Context
- `@feeblo/sdk` (`packages/sdk`) is public, has a `build` script, and is wired for npm publish (`publishConfig.access: public`).
- `.changeset/` exists but is empty; changesets is **not** required. Versioning is manual.
- `publish-images.yml` already triggers on `release: published` to build/push Docker images to GHCR.
- Goal: Docker image releases must be independently triggerable (release event only) **without** publishing the SDK. SDK npm publish is opt-in via a `sdk@X.Y.Z` release tag.

## Decisions (confirmed with user)
- Docker trigger: **release event only** (no `workflow_dispatch`).
- SDK publish: gated by **`sdk@` tag filter** so a normal `v*` release does not publish it.
- No changesets. Manual version bump in `packages/sdk/package.json`.

## Changes

### 1. New workflow `.github/workflows/publish-sdk.yml`
- Trigger: `release: published`.
- Job `publish` runs only `if: ${{ startsWith(github.event.release.tag_name, 'sdk@') }}`.
- Steps:
  - Harden Runner (allowed-endpoints: `api.github.com:443`, `github.com:443`, `registry.npmjs.org:443`).
  - Checkout (no persist-credentials).
  - Reuse `./.github/actions/setup-node` (pnpm + `.node-version` + install).
  - Verify version: strip `sdk@` from tag, compare to `packages/sdk/package.json` version; fail if mismatch.
  - Build: `pnpm --filter @feeblo/sdk build`.
  - Publish: `npm publish --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

### 2. `publish-images.yml` (optional refinement)
- Add `startsWith(github.event.release.tag_name, 'v')` to the existing job-level `if` so an `sdk@…` release does not push redundant Docker images.
- New `if`:
  ```yaml
  if: >-
    github.repository == 'G3root/feeblo' && (
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
      (github.event_name == 'release' && startsWith(github.event.release.tag_name, 'v'))
    )
  ```
- Applies to both `build-and-push` and `merge-manifests` jobs.

### 3. Required secret (user action, no code change)
- Create an npm **Automation** token at npmjs.com → Access Tokens.
- Add as repo secret **`NPM_TOKEN`**.

### 4. Pre-publish self-containment check (verification)
- `packages/sdk` does **not** import `@feeblo/config` at runtime (confirmed via grep); vite bundles a self-contained `dist/`. No dependency pre-build needed.
- Before first real publish, run `npm pack --dry-run` in `packages/sdk` and confirm the tarball is standalone.

## Resulting flow
- Release `v1.0.0` → Docker images only.
- Release `sdk@1.2.3` (with `packages/sdk/package.json` version `1.2.3`) → SDK published to npm (Docker images also build unless gated to `v*`).

## Manual release steps
1. Bump `version` in `packages/sdk/package.json`.
2. `git commit` + push.
3. Create a GitHub Release tagged `sdk@X.Y.Z` → SDK publishes to npm.
4. Create a GitHub Release tagged `vX.Y.Z` → Docker images build/push.
