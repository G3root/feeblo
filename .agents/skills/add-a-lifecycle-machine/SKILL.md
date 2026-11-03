---
name: add-a-lifecycle-machine
description: Declare a lifecycle that is currently implicit — a status column, a status union, or a cluster of booleans — as an XState machine, and derive the guards, predicates and tests from it. Use when a feature has named states with rules about which may follow which, when those rules are expressed as scattered `WHERE status = …` clauses or `status === "a" || status === "b"` checks, or when a UI flow has states that are mutually exclusive in practice but not in type.
plain: "XState owns the named states of a lifecycle; Effect owns the work; the database (or the actor) owns the row."
---

# Add a lifecycle machine

A lifecycle machine declares named states and the events that move between them.
This repo already had the pattern before XState: `email-outbox/delivery-state.ts`
and `integrations/core/src/integration-lifecycle.ts` are transition tables. The
machine generalises that into something a test can walk and a UI can read.

Read this file before writing one, then copy the nearest of the two worked
examples below rather than starting from a blank file.

Before changing Effect or XState code, read `node_modules/effect/AGENTS.md`.
Then read the pinned XState sources named in "API notes" — the alpha's API is
not the API in most tutorials, and guessing costs a compile cycle each time.

## 1. Decide what the machine is allowed to own

The one decision that goes wrong: **an actor is not automatically the right
interpreter.** Ask where the authoritative state lives.

| The state lives in… | Use | Do not use |
| --- | --- | --- |
| A database row, durable across process death | A pure machine read with `transition()` / `resolveState()` | `createEffectActor` |
| One process's memory, for the length of one operation | `setupEffect` + `createEffectActor` | a status column |
| A React component | `setup` + `@xstate/react`'s `useMachine` | `@xstate/effect` |

A durable row must not be mirrored into an in-memory actor as the source of
truth. The import worker's recovery story is "the next process to find an
expired lease resumes the row"; an actor's snapshot has no such property.
`packages/domain/src/data-transfer/machine.ts` says this in its header and is
the reference for the pure form.

Conversely, a machine that registers Effect actions or Effect actors **must** be
started with `createEffectActor`; `setupEffect`'s own documentation says so. If
you take that route, run it inside `Effect.scoped`, hand it to `join`, and let
the failure land in the caller's error channel.

## 2. Write the states, then prove them

List every state and every terminal state before writing code. Then check:

- Does the machine declare exactly the states the stored vocabulary allows?
  They must be one set, and a test must compare them
  (`machine.test.ts` in `data-transfer` does this against
  `DATA_IMPORT_STATUSES`).
- Is every state reachable from the initial one? A state with no inbound edge is
  dead, and it will still be written by something.
- Are the terminal states the ones with no outgoing edges? Do not maintain a
  separate "active" list — derive `isActive = !isTerminal`. Three copies of that
  predicate had already drifted before the import machine replaced them.
- Is a self-transition actually a lifecycle event? It usually is not. The import
  job's lease re-claim keeps the row `running`, so it belongs in SQL, not in the
  graph — a self-transition would make "handled" indistinguishable from
  "rejected". The same is true of a *stale* reservation: `createdAt < now - t`
  is a lease predicate on an unchanged state, not an edge.

### Two shapes of event

Most machines mix them, and naming which is which keeps the derived SQL honest.

A **transition** has one target. `sourceStatesFor(event)` generates its `WHERE`
and `targetStateFor(event)` generates its `SET`; a state that is not a source
cannot be moved by it.

A **decision** has several targets and is asked before any row exists. The
subscription's `request` is one: what a consent request means depends on the
subject, and the answer may be any of three states. Do not try to generate SQL
from a decision — it never writes. Give the machine a `none` state for "no row
at all" so a first request is a normal transition rather than a special case,
and export it separately (`nextStateForRequest`).

A decision event must not be a self-transition in the *derived* set either: if
a state takes the event and stays put, `sourceStatesFor` will not see it.
`subscription-machine.test.ts` asserts "no source is also the target" for every
transition event, which is the assertion that keeps that true.

### Legacy states

A state that nothing writes any more but rows still hold is not dead code —
deleting it breaks reading old data. Declare it with outgoing edges only,
name it (`LEGACY_EMAIL_INTENT_STATES`), and assert it has **no inbound edge**.
That turns "do not re-introduce a pause" into a failing test instead of a
comment, and it keeps the reachability check honest by naming its one
exception rather than dropping the check.

## 3. Derive the guards instead of restating them

The value of the machine is one graph, read from both directions:

```ts
// The SQL this replaces a hand-written WHERE with.
inArray(schema.dataImportJobTable.status, [...sourceStatesFor("cancel")])
```

```ts
// The UI affordance the same graph answers.
const cancelable = canCancelDataImportStatus(job.status);
```

Every hand-written `status === "x"` that decides a transition is a second copy
of the graph and will drift. If a call site needs a different question — "is
this still running?" — ask it as a lease or content predicate, not as another
status list.

## 4. Put the machine where its readers are

- A server lifecycle: `packages/domain/src/<entity>/machine.ts`, exported
  through `packages/domain/package.json`'s export map so the browser can import
  it by path.
- A client flow: `apps/web/src/dashboard/features/<feature>/lib/<name>-machine.ts`,
  with the hook beside it as a thin adapter (`send` on render, `toX` at the
  edge).
- **Never** `@feeblo/domain-contracts`. That package depends only on `effect`
  (`docs/adr/0002`); adding `xstate` there breaks the invariant that lets both
  browser and server import it.
- Client packages may import a machine from `@feeblo/domain`, but that puts
  `xstate` in the dashboard bundle. Say so in the PR when you do it.

## 5. Test the graph, and the edges

`packages/domain/src/data-transfer/machine.test.ts` is the template: plain `it`
from `@effect/vitest` (the repo bans `Effect.run*` and `ManagedRuntime.make` in
test files), six assertions that between them cover every cell of the graph.

Cover, at minimum:

1. The declared states equal the stored vocabulary.
2. The full set of allowed `(from, to)` pairs, written out — this is the
   assertion that fails when an edge moves.
3. Each event's `sourceStatesFor`, so the generated SQL is pinned.
4. Terminal states have no outgoing edges, and the active predicate is their
   negation.
5. Every state is reachable from the initial state.

For a UI flow, test the reducer-level behaviour through `transition()` with
`machine.getInitialSnapshot()`: the debounce, the abort on leaving `checking`,
and the two `onDone` outcomes.

Property tests are welcome but rarely worth it under ~50 cells; exhaustive
enumeration is cheaper to read and fails more legibly.

## 6. API notes for this pin (`xstate@6.0.0-alpha.73`)

The alpha diverges from every XState 5 tutorial. What is actually true here:

- `setup(config)` returns `{ createMachine, extend, … }`. Build a machine with
  `setup({ schemas, actors }).createMachine({ … })`.
- **`assign` does not exist.** A transition carries context as a patch:
  `{ target, context: { … } }` or `context: ({ event }) => ({ … })`.
- **The `guard` key does not exist.** A transition is a target string, a
  `{ target, context }` object, or a function returning one, or `undefined` to
  decline. Put the condition in the function:
  ```ts
  onDone: ({ event }) => ({
    context: settledContext(event.output),
    target: event.output.available ? "available" : "taken",
  })
  ```
  The compiler enforces this with a message on the `guard` key itself.
- `fromPromise` does not exist. Use `createAsyncLogic`, whose `run` receives
  `{ input, signal }`; `signal` aborts when the actor stops, which is how a
  superseded request is cancelled.
- `setup`'s `schemas` expects a Standard Schema. Effect Schema is not one, so
  client machines wrap with `Schema.toStandardSchemaV1(...)`, and server machines
  use `@xstate/effect`'s `setupEffect`, which accepts Effect Schema directly.
  Schemas are type-only unless a `validator` is configured — no runtime cost.
- Reading a machine without starting it:
  `machine.resolveState({ value, context })`, then
  `transition(machine, snapshot, event)` returns `[nextSnapshot, effects]`. An
  unhandled event returns the same snapshot identity.
- `@xstate/react` 7 exposes `useMachine`, `useActor`, `useSelector`,
  `createActorContext`. It runs XState's interpreter, so it cannot run a
  `setupEffect` machine that declares Effect actions.

## 7. Adding or bumping the dependency

XState 6 is alpha, so its dist-tags lie: `@xstate/effect@alpha` resolves to
`0.1.0-alpha.4` (a month old, peer `effect ^4.0.0-rc.115`) while the newest
build is published under `latest` as `1.0.0-alpha.12`. Always pin exact
versions in the `catalog`, never `@alpha`.

`xstate`, `@xstate/effect` and `@xstate/react` publish together and peer on each
other by exact alpha range. A bump is a three-line catalog change plus the same
three lines in `minimumReleaseAgeExclude`, with the date they were published —
the age gate refuses anything under a day old, and an alpha is published
fortnightly at best. Drop the exclusions once the versions are a day old.

A dependency addition needs owner sign-off (`AGENTS.md`, "Boundaries and
sign-off"): land it in its own commit.

## 8. Finish

```sh
pnpm check
```

`pnpm check` is the gate: the toolchain guard, every package's `tsrs --noEmit`,
type-aware Oxlint plus the formatter, and Knip. Knip fails on a declared
dependency nothing imports, so a machine you wrote but did not wire up will
show as an unused package.

## Worked examples in this repo

| Machine | Kind | Read it for |
| --- | --- | --- |
| `packages/domain/src/data-transfer/machine.ts` | pure, durable, `setupEffect` | deriving SQL guards, replacing three drifted predicates |
| `packages/domain/src/email-outbox/intent-machine.ts` | pure, `setupEffect` | a legacy state with no inbound edge; one `transitionIntent` replacing five guarded writes |
| `packages/domain/src/email-subscription/subscription-machine.ts` | pure, `setupEffect` | transition events next to a decision event; the `none` state |
| `apps/web/src/dashboard/features/register/lib/slug-availability-machine.ts` | client, `setup` + `@xstate/react` | debounce-as-state, abort-on-exit, actor `input` instead of a mount effect |
| `packages/domain/src/email-outbox/delivery-state.ts` | table, pre-XState | the derived-guard pattern the machines follow |
| `integrations/core/src/integration-lifecycle.ts` | table, pre-XState | see the warning below |

`integration-lifecycle.ts` is the cautionary example, not the model: it declares
two graphs, tests them, and **nothing consults either one**. Every connection
lifecycle write in `integrations/*` is still guarded by a hand-written
`eq(lifecycle, …)`. A table nobody reads is documentation that rots.

## Do not

- Do not add `xstate` to `@feeblo/domain-contracts`.
- Do not start a `setupEffect` machine with plain `createActor`, or an actor
  whose state must survive a restart.
- Do not keep a hand-written status list next to the machine "just for SQL".
- Do not disable a rule to get green. `xstate-effect/no-inline-effect` is
  available in the `@xstate/effect/oxlint` export when `setupEffect` machines
  start inlining Effects; fix the machine instead of silencing it.
