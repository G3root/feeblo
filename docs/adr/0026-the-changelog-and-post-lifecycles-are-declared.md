# ADR 0026: The changelog and post lifecycles are declared, not inferred

## Decision

Two lifecycles that were previously expressed only as scattered guards are now XState machines, and every write asks them:

- **Changelog publication** — `packages/domain/src/changelog/machine.ts`, states `draft | scheduled | published`, events `publish | unpublish`. The write vocabularies in `changelog/schema.ts` and `changelog/public-api/schema.ts`, the "does this save publish it" predicate in the dashboard handler and the Public API operation, the delivery-time `status = 'published'` re-check in `email-outbox/content.ts`, and the dashboard's `scheduled → draft` rewrite all read it.
- **Post presence and engagement** — `packages/domain/src/post/machine.ts`, two graphs. Presence is `listed | archived | merged` with events `archive | unarchive | merge | unmerge`; engagement is `open | locked` with `lock | unlock`. `isUnlocked`/`isUnlockedPublic`, the merge and unmerge guards, the delete-survivor guard, `activePostVisibility`, the new `unlockedPostCondition`, both copies of `requireNotMergedActivityState`, and the lock/archive activity decision read them.

The post's _status_ (`post_status`) is deliberately not modelled. It is the workspace's own vocabulary — a status is named, coloured and ordered by the customer, and a post may move between any two of them — so there are no edges to declare. What was duplicated there was the _side effect_: a move into a `CLOSED` status records an immediate `post.closed` intent, every other move joins the coalescing window. That rule now lives once, as a decision in `post/status-intent.ts`, alongside the window constant and the intent shape, and both the editor and the comment surfaces call it.

## Why

**Two graphs for the post, not one.** The alternative was a single six-state product (`listed | archived | merged` × `open | locked`). It was rejected on a mechanical ground: `merge` and `unmerge` preserve the lock bit — `unmerge` clears `archivedAt`, `mergedAt` and `mergedIntoPostId` and leaves `lockedAt` alone — so in a flattened graph each of those events would have two targets. `presenceTargetStateFor` is what the guarded `UPDATE`s are built from, and a function that answers "one of two states" cannot generate a `SET`. Two graphs keep every event single-target, and the product is then expressed where it belongs: as two derived predicates (`presenceOf`, `engagementOf`) over one row.

**`scheduled` is kept, drain-only, rather than deleted.** The status has had no writer since scheduled publishing was dropped, and both write vocabularies already excluded it. It stays in the graph because rows filed while the scheduler was planned can still hold it, and because the dashboard's rewrite of such a row to `draft` is a real transition that deserves an edge rather than a cast. It is declared with outgoing edges only, and `machine.test.ts` asserts it has **no inbound edge** — so "do not re-introduce scheduling by writing the status" is a failing test instead of a comment. If this deployment turns out to hold no such rows, the state can be deleted and that assertion removed with it.

**The post's denormalised columns still need a state-to-SQL mapping.** `post/public-visibility.ts` holds `satisfies Record<TPostPresence, SQL>` tables, because a presence is stored as two nullable columns and a state has to be turned back into a predicate. The mapping is total (a state added to the machine is a compile error until it is described) and callers never index it by name: they ask a question (`presenceSourceStatesFor("merge")`) and the mapping supplies the fragment. That is what keeps `activePostVisibility` from drifting from the merge guard.

## Consequences

- `isUnlocked` and `publicPostVisibility` now emit their predicates through `or(...)`/`and(...)` rather than a single `sql` template, so the generated SQL carries extra parentheses. Semantics are unchanged and the post read tests cover it.
- The post merge and delete paths select one more column (`archivedAt`) so a row can be read back into a presence state instead of being tested column by column.
- `apps/web` imports `@feeblo/domain/changelog/machine`, which puts `xstate` in the dashboard bundle. `apps/web` already imports `@feeblo/domain/data-transfer/machine` for the same reason (the browser must ask the same graph the server's guarded writes ask), so this adds no new dependency, only a slightly larger one.
- Adding a post presence or engagement state is now a compile error in `public-visibility.ts` and a test failure in `machine.test.ts`, in that order.
- The changelog's `publishedAt` invariant is still enforced only by the Public API (`changelog/public-api/operations.ts`). The dashboard supplies the timestamp from its publish dialog, so folding the rule into the machine would have rejected a request the UI cannot produce — a behaviour change, not a refactor. It remains a candidate for a follow-up that makes the invariant uniform.
