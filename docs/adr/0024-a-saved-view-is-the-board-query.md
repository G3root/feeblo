# ADR 0024: A saved view is the board's own query, stored per member

## Decision

A saved view is a `saved_view` row holding the board's filter and ordering state as one `jsonb` document, validated on write by `BoardQuery` in `@feeblo/domain-contracts/board-query`. There is no second query language: the dashboard store, the board's live query, and the persisted row all read the same Effect Schema, so a filter added to it is saved, applied, and executed without a translation step.

Three properties follow from that and are deliberate:

1. **The row is personal.** `saved_view.member_id` is the owner, and every RPC scopes on the session's member for the requested workspace rather than on anything in the payload. A second member of the same workspace gets `NotFoundError` when they name somebody else's view id for update or delete, and an empty list when they ask for their own.
2. **The surface is the `board_id` column.** `NULL` is the organization-wide feedback list; a value is one board. The toolbar therefore keeps separate views per surface without a `scope` enum that would only restate the null.
3. **Ids inside `query` are not foreign keys.** A deleted tag or removed member makes a saved view stale, not invalid; the board renders the same empty match it would for a hand-picked missing id. Only the board a view belongs to is a real reference, because a view on a deleted board has no surface to be shown on.

The unique constraint on `(member_id, board_id, name)` is `NULLS NOT DISTINCT`. Without that, Postgres treats nulls as distinct and the same name could be saved twice on the feedback list — the surface members use most.

## Why

The filters were already client state (`board-store-context.tsx`) and were already lost on every navigation. Storing them removes that loss and gives "Assigned to me" a home, since it is the same shape as any hand-built filter.

**Why not a filter DSL.** A serialized expression tree would let a saved view describe queries the board does not have, and every predicate the live query can execute would then need a matching parser — two grammars to keep in agreement, with the disagreement only visible at render time. A closed struct cannot drift: `inArray`, the tag subquery, and the status preset are the only predicates, so the schema is the whole vocabulary.

**Why personal and not shared.** Sharing is a different feature with a different authorization question (who may publish a view to the workspace, and may they edit it after). Restricting ownership to the session's member keeps the entire authorization surface to one predicate and leaves room to add a `visibility` column later without changing what an existing row means.

**Why the assignee is on the post, not on a join table.** One post has at most one assignee, so a `post.assignee_member_id` column with `ON DELETE SET NULL` is the honest model: removing a member unassigns their work rather than losing the post. The same-workspace invariant is enforced by `PostWriteService` before the write, because a single-column foreign key cannot express it — a composite `(member_id, organization_id)` reference with `ON DELETE SET NULL` would blank the not-null organization column on delete.

## Consequences

- Assignment rides `posts.status`, the grant the status and ETA fields already use; it is a triage decision, not a separate authority.
- `ASSIGNEE_CHANGED` joins the activity vocabulary, so the timeline explains who moved the work. `post_activity.kind` is plain text, so no migration accompanies it.
- Public reads null `assigneeMemberId` on every row, including the viewer's own: the assignee is a different person from the author, so authorship says nothing about whether the id may be revealed. `redactCreatorIdentity` in `public-actor.ts` does both.
- A saved view is client state while it is applied. Navigating to another route resets the board to that route's view, the same way the built-in presets do; persisting the applied view in the URL is a separate change.
