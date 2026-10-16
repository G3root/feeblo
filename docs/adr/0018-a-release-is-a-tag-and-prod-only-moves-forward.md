# ADR 0018: A release is a tag, and `prod` only moves forward

## Decision

A release is an annotated tag on `main` plus the GitHub Release that publishes the Docker images. `prod` is a deployment pointer for the dashboard Worker (`apps/web/wrangler.jsonc`, Worker `feeblo`), which Cloudflare's Git integration builds from that branch. It is not a development branch: it only ever moves to the commit of a release tag, and `.github/workflows/promote-prod.yml` is the only thing that moves it. The workflow takes a tag name, refuses it unless the tag's commit is already on `main` and `origin/prod` is an ancestor of it, and then pushes `"${target}:prod"`. Every promotion is therefore a fast-forward.

Two repository rulesets hold the invariant. _prod moves forward only_ (target `branch`, `refs/heads/prod`, rules `non_fast_forward` and `deletion`) rejects a rewrite or a delete of the branch even when someone has the permissions to attempt one. _release tags are immutable_ (target `tag`, `refs/tags/v*` and `refs/tags/sdk*`, rules `update` and `deletion`) makes a published tag a fixed point. Neither ruleset blocks creation: tags are still cut by hand.

A rollback is a revert on `main` released as the next patch version — `git revert <sha>`, tag `v1.2.1`, promote it like any other release. `prod` is never rewound and `main` is never rewritten. The inputs of the workflow default to `dry_run: true`, so the first run of a release reports what it would do and a promotion is a second, explicit run.

## Why

`prod` was created as a release branch, and `v1.2.3` was squash-merged into it (PR #165). A squash produces a commit that no other branch shares, so `prod` stopped being a stop on `main`'s road: the two branches became unrelated, and the next release could only reconcile them by a force push, which is what happened on 2026-10-16. Nothing else in the flow was wrong — the manual tag, the image publish, the manual Dokploy deploy, and Cloudflare watching `prod` all work. The defect was that a release could _create_ history instead of _pointing at_ it.

The invariant is one sentence: `prod` may only ever advance to a commit that is already on `main`. Under it, promotion is a plain push, the fast-forward is a property of the shape rather than a hope, and a mistake fails as a rejected push or a failed check instead of a rewritten branch. The workflow runs the same `git merge-base --is-ancestor` test that the ruleset enforces, so a tag cut from a hotfix branch fails the job with the reason attached rather than silently forking `prod`.

## Consequences

Releasing now ends with one manual run of **Promote prod** after the image is deployed, and the branch can no longer be merged by hand. Because the workflow is `workflow_dispatch`, its button exists only once this file is on the default branch. Publishing a release without promoting it leaves Cloudflare one version behind, which is visible: the deployed Worker commit and `prod` are the same thing.

Cloudflare's own deployment history is the fast rollback lever, and the git-visible truth is a revert released as the next patch. A rollback also means old code against a newer schema, because the server image runs `packages/db-migrator` before `apps/server` starts, so a migration has to be expand-only for one release — add and backfill in release N, remove in N+1 — for the rollback to be a real option rather than a crash loop.

The tags ruleset blocks deleting a tag pushed by mistake, which is deliberate friction: retiring a tag has to be an explicit act, not a side effect of a bad release. What is not blocked is tagging an older commit for a one-off build, so the workflow's ancestry check, not the ruleset, is what decides whether a tag may be promoted.

Pushing with `GITHUB_TOKEN` starts no other workflow in this repository because nothing else triggers on `prod`; the Worker's Git integration receives the push as an ordinary branch event. If the Cloudflare deploy ever moves into this repository's release workflow (`wrangler versions upload` and `versions deploy` from GitHub Actions), `prod` and this workflow are deleted together, because the tag would then drive both artifacts directly.
