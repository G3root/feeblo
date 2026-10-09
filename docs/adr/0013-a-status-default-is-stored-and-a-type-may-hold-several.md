# ADR 0013: A status's default is stored, and a workspace may hold several statuses of one type

## Decision

`post_status` gains `is_default boolean not null default false`, seeded `true` on the `PENDING` status of every new workspace and backfilled to the existing `PENDING` row of every workspace in the migration that adds it. A partial unique index on `(organization_id) WHERE is_default` makes "exactly one default per workspace" a database fact. The default status cannot be deleted; deleting any other status repoints its posts at the default in the same transaction, and the confirmation dialog states how many posts that is before it runs.

The unique index on `(organization_id, type)` is dropped and replaced by that partial index. A workspace may now hold several statuses of one type, which is what makes the statuses settings page's per-section "New" button possible. The invariant worth enforcing moved from "one status per type" to "one default per workspace".

The unique index on `(organization_id, order_index)` stays, and the read order stays flat `orderIndex`. The settings page groups rows into sections by `type` itself; the API-key and anonymous status lists keep the array order they already published.

Statuses are managed under a new `statuses.*` permission granted at manager, alongside `tags.*`, `roadmap.*` and `changelog-categories.*`.

## Why

The default is stored rather than derived from the `PENDING` type because a workspace must be able to say which status it means without renaming anything, and because deriving it makes every consumer's correctness depend on a sort order. The concrete failure the stored flag removes: before this change four call sites read "the default" as `statuses[0]` — the widget's submission path, the Slack and Discord integrations, and the shared create form — so reordering statuses silently changed where new feedback landed, with nothing in the UI to say so.

The `(organization_id, type)` index had to go for the feature to exist at all. "Createable statuses" and "at most one status per type" are contradictory, and the index was not referenced anywhere in code — no constraint name was matched on, no error path distinguished it — so dropping it costs no behaviour beyond the invariant itself. Replacing it with the partial index keeps a real invariant in the database rather than moving it into application code: a workspace cannot end up with two defaults or none.

`orderIndex` was left alone deliberately. Making it per-type would have changed the array order of `GET /api/v1/statuses` and the anonymous status list — a published shape a workspace can already observe, pinned by a test in `packages/domain/src/public-api/api-live.test.ts`. A settings-page grouping is not worth moving a contract, and the page can group by `type` without the server's help.

The default is repointed silently, with no activity row, notification or webhook delivery per affected post. Collapsing a status is a configuration change, not N post edits; fanning out one event per post turns an administrative cleanup into a burst of customer-visible mail.

## Consequences

Deleting a status now has three effects beyond removing the row: posts move to the default, `roadmap_column` rows whose `config.statusId` names it are deleted (a lane bound to a status that no longer exists renders as a permanently empty column), and `github_sync_rule` rows naming it cascade away with the foreign key. `PostStatusDeletePreview` reports all three counts so the confirmation dialog can name what it is about to remove, and `PostStatusDelete` returns what it actually did so the toast reports the truth rather than the estimate.

`isDefault` is part of the shared status read model, which means the anonymous status list carries it. That is intentional: the create form is shared by the dashboard, the public board and the widget, and the latter two read the catalog without a session. A dashboard-only field would have left those two surfaces resolving the default differently from the dashboard. `packages/domain/src/public-api/schema.ts` is unchanged — the API-key DTO is hand-written (ADR 0004) and does not pick the field up.

The statuses settings page reorders within a section only. A drop onto another section is ignored, and moving a status between sections is the edit dialog's `type` field. `PostStatusReorder` names one type and the full order of its statuses, and rejects a list that does not cover the section exactly once, because a partial list would leave rows in a position that is neither the old order nor the new one. Positions are applied in two passes — every row in the section is parked on a negative index, then assigned its final one — because the new positions are a permutation of the old and a row-by-row assignment would transiently collide with the unique index on `(organization_id, order_index)`.

`packages/post-ui` resolves the default from row data rather than importing `pickDefaultPostStatus` from `@feeblo/domain`. That package imports `@feeblo/domain/*` for types only, because a value import pulls the server domain graph into the browser bundle and breaks its Vitest browser run. The rule is therefore stated twice — once in `@feeblo/domain-contracts/post-status-default` for the widget and the Slack and Discord integrations, once in the create form — and the two must be changed together.
