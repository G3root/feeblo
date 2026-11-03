# ADR 0024: A saved view is the board's own query, stored per member

## Decision

A saved view is a `saved_view` row holding the board's filter and ordering state as one `jsonb` document, validated on write by `BoardQuery` in `@feeblo/domain-contracts/board-query`. There is no second query language: the dashboard store, the board's live query, and the persisted row all read the same Effect Schema, so a filter added to it is saved, applied, and executed without a translation step.

The row also carries a name, an optional description, and an `orderIndex`, and it is addressed by its own route:

```text
/{organizationId}/feedback/view/{viewId}
/{organizationId}/board/{boardSlug}/view/{viewId}
```

A view is a place, not a client-side mode. The route resolves the row and hands its filters and its ordering to the board as that board's initial state, so the URL and the screen cannot disagree, a reload comes back to the same result set, and a link can be shared — the row is still personal, so the recipient gets the same "not available" answer any other member would.

Four properties follow from that and are deliberate:

1. **The row is personal.** `saved_view.member_id` is the owner, and every RPC scopes on the session's member for the requested workspace rather than on anything in the payload. A second member of the same workspace gets `NotFoundError` when they name somebody else's view id for update or delete, and an empty list when they ask for their own.
2. **The surface is the `board_id` column.** `NULL` is the organization-wide feedback list; a value is one board. The toolbar therefore keeps separate views per surface without a `scope` enum that would only restate the null.
3. **Ids inside `query` are not foreign keys.** A deleted tag or removed member makes a saved view stale, not invalid; the board renders the same empty match it would for a hand-picked missing id. Only the board a view belongs to is a real reference, because a view on a deleted board has no surface to be shown on.
4. **`orderIndex` is a whole-list rewrite.** `ReorderSavedViews` takes every id on the surface and rejects a list that does not name exactly the member's views, then writes the positions in one statement. Positions are only meaningful relative to each other, so a single "move A between B and C" would be a half-statement about a list, and a stale client would silently leave one view at its old index.

Names are not unique. A view is a personal shortcut, and duplicating one to try a variation should not require inventing a suffix first; the two pills carry the same label but link to different ids, and the row is ordered. The route is what identifies a view, not its name.

## Why

The filters were already client state (`board-store-context.tsx`) and were already lost on every navigation. Storing them removes that loss and gives "Assigned to me" a home, since it is the same shape as any hand-built filter.

**Why not a filter DSL.** A serialized expression tree would let a saved view describe queries the board does not have, and every predicate the live query can execute would then need a matching parser — two grammars to keep in agreement, with the disagreement only visible at render time. A closed struct cannot drift: `inArray`, the tag subquery, and the status preset are the only predicates, so the schema is the whole vocabulary.

**Why personal and not shared.** Sharing is a different feature with a different authorization question (who may publish a view to the workspace, and may they edit it after). Restricting ownership to the session's member keeps the entire authorization surface to one predicate and leaves room to add a `visibility` column later without changing what an existing row means.

**Why the assignee is on the post, not on a join table.** One post has at most one assignee, so a `post.assignee_member_id` column with `ON DELETE SET NULL` is the honest model: removing a member unassigns their work rather than losing the post. The same-workspace invariant is enforced by `PostWriteService` before the write, because a single-column foreign key cannot express it — a composite `(member_id, organization_id)` reference with `ON DELETE SET NULL` would blank the not-null organization column on delete.

## Consequences

- Assignment rides `posts.status`, the grant the status and ETA fields already use; it is a triage decision, not a separate authority.
- `ASSIGNEE_CHANGED` joins the activity vocabulary, so the timeline explains who moved the work. `post_activity.kind` is plain text, so no migration accompanies it.
- Public reads null `assigneeMemberId` on every row, including the viewer's own: the assignee is a different person from the author, so authorship says nothing about whether the id may be revealed. `redactCreatorIdentity` in `public-actor.ts` does both.
- The tab strip is one row: the built-in presets and the saved views, clipped together. Which tabs fit is measured per tab (a long name ellipsizes inside its own pill), the clipped ones stay in the DOM but out of the row's flow (`absolute w-max visibility: hidden`) so the strip is exactly as wide as the tabs it shows while the next measurement can still read their widths. Keeping them in flow and capping the strip to a measured pixel width was the earlier shape, and every way of letting that measurement go stale — a drag's transforms, a reorder, a rename — surfaced as a gap before the "more" button. On a phone the strip is `display: none`, which reports a zero width, so every tab counts as clipped and the popover carries the whole set — including the built-in presets, which is the only way to reach them there.
- The "more" button reserves a _constant_ width in that calculation, and is bounded between a minimum and that maximum. Its label is the active tab's name when the tab you are on is one of the clipped ones, so measuring the rendered label would make the count depend on its own result: a long name would widen the button, hide one more tab, which keeps the name on the button, and the two states would take turns. `countFittingTabs` is a pure function for exactly this reason, and its test asserts that reserving space can never _increase_ how many tabs are shown.
- A view's pills are drag-reorderable and carry their actions in a context menu (edit, duplicate, delete) as well as in the overflow popover's per-row menu. Duplicate copies the query and description into a new row named `copy`, `copy 2`, … — it is the way to start from a view without re-deriving its filters, since no affordance overwrites a stored query. Edit renames and re-describes; it never rewrites the filters, which is why the dialog takes the query as a prop and the save path passes the live one.
- Hovering a pill shows a tooltip with the view's full name and its description — the pill truncates at 160px, so the tooltip is where a long name is readable, and the description appears nowhere else in the strip.
- The strip is three components: `BoardViewTabs` (collection, dialog, mutations), `ViewTabStrip` (measurement, drag order, overflow button) and `SavedViewPill` (a memoized tab). They are split by what changes: a measurement or a popover toggle must not re-render the dialog form or every pill's menus. `BoardViewTabs` subscribes to the active view's _id_ only, and reads the board's filters from the store snapshot when the dialog opens, so typing in the search box does not re-render the strip.
- `ASSIGNEE_CHANGED`'s values are `member` ids, so the Public API reports `null` for both and passes every other kind's values through; see `toPublicApiPostActivity`.
- "Assigned to me" is not a built-in view. It is a shortcut at the top of the assignee filter and, for a permanent one, a saved view the member creates.
