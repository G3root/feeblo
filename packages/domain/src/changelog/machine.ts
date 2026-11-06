import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { isUnhandled, transition } from "xstate";

/**
 * The publication lifecycle of one changelog entry, as an XState machine.
 *
 * Before this file the graph existed five times and was declared nowhere:
 * `changelog/schema.ts` and `changelog/public-api/schema.ts` each held a status
 * vocabulary and a "statuses a write may set" narrowing, `handlers.ts` and
 * `changelog/public-api/repository.ts` each recomputed "is this a publish"
 * before recording the publication intent and notifying subscribers,
 * `email-outbox/content.ts` re-checked `status = 'published'` at send time so an
 * unpublish between intent and delivery could not email a dead link, and
 * `apps/web` cast `scheduled` to `draft` because no write may set it. Nothing
 * tied those five together, so "may a published entry return to draft?" was
 * answerable only by reading every call site.
 *
 * `scheduled` is a **drain-only** state, not a live one. Scheduled publishing was
 * never implemented — no worker publishes an entry when its time arrives — so
 * every write vocabulary already excludes it, and `apps/web` rewrites a stored
 * `scheduled` row to `draft` on save. Rows filed while the scheduler was
 * planned can still hold the value, which is why it stays in the graph with
 * outgoing edges only rather than being deleted: `machine.test.ts` asserts it
 * has **no inbound edge**, so "do not re-introduce scheduling by writing the
 * status" is a failing test instead of a comment. If this deployment turns out
 * to hold no such rows, the state can be deleted outright and that assertion
 * removed with it.
 *
 * Two things are deliberately *not* in the machine:
 *
 * - **Creation.** A create names its initial state (`draft` or `published`) and
 *   there is no prior row to move from, so there is no `none` state and no
 *   decision event: `CHANGELOG_WRITE_STATES` below is the set of states a create
 *   or update may name, which is the same fact stated once.
 * - **`publishedAt`.** The column records when an entry went live; it is
 *   metadata of the `published` state, not a state of its own, and a republish
 *   is not a transition. The Public API requires it on a publish
 *   (`changelog/public-api/operations.ts`); the dashboard supplies it from the
 *   publish dialog. Folding it into the graph would have made the machine
 *   reject a request the dashboard cannot produce, which is a behaviour change
 *   wearing a refactor's clothes.
 */
export const CHANGELOG_STATES = ["draft", "scheduled", "published"] as const;

export type TChangelogState = (typeof CHANGELOG_STATES)[number];

export const CHANGELOG_EVENTS = ["publish", "unpublish"] as const;

export type TChangelogEvent = (typeof CHANGELOG_EVENTS)[number];

export const changelogMachine = setupEffect({
  schemas: {
    events: {
      publish: Schema.Struct({ type: Schema.Literal("publish") }),
      unpublish: Schema.Struct({ type: Schema.Literal("unpublish") }),
    },
  },
}).createMachine({
  context: {},
  id: "changelog",
  initial: "draft",
  states: {
    // Editable and invisible to readers. Publishing is the only move out.
    draft: {
      on: {
        publish: { target: "published" },
      },
    },
    // Drain-only: nothing enters this state, and both exits exist so a row
    // that still holds it can be published or rewritten as the draft it
    // effectively is.
    scheduled: {
      on: {
        publish: { target: "published" },
        unpublish: { target: "draft" },
      },
    },
    // Public. `unpublish` returns it to draft; a second publish is a write
    // that changes nothing, so the graph has no self-transition and the write
    // paths do not record a second publication intent for it.
    published: {
      on: {
        unpublish: { target: "draft" },
      },
    },
  },
});

/** A snapshot for a stored status, built without starting an actor. */
const snapshotFor = (state: TChangelogState) =>
  changelogMachine.resolveState({ context: {}, value: state });

/**
 * The status the machine lands in after `event` from `state`.
 *
 * An event a state does not handle returns the state it started in, which is
 * what makes `canTransitionChangelog` a two-state comparison: the machine has
 * no self-transitions, so "unchanged" means "rejected".
 *
 * `stateAfter` is declared before the derived predicates below because they
 * all read it; `targetStatesFor` and `inboundStatesFor` call
 * `canTransitionChangelog`, which is initialized by the time either runs.
 */
const stateAfter = (
  state: TChangelogState,
  event: TChangelogEvent
): TChangelogState => {
  const [next] = transition(changelogMachine, snapshotFor(state), {
    type: event,
  });
  // SAFETY: the machine is flat — every state is a top-level string and every
  // target is one of the three `TChangelogState` members — so a `StateValue`
  // read from it is always a status. `machine.test.ts` walks the whole graph
  // rather than trusting this comment.
  return next.value as TChangelogState;
};

/**
 * True when the machine handles `event` at all.
 *
 * `isUnhandled` rather than comparing the resulting state to the starting one:
 * the two disagree on a self-transition, which leaves the value unchanged while
 * still being a move.
 */
const handles = (state: TChangelogState, event: TChangelogEvent): boolean => {
  const before = snapshotFor(state);
  return !isUnhandled(
    before,
    transition(changelogMachine, before, { type: event })
  );
};

/** Every status from which `event` moves the entry. */
export const sourceStatesFor = (
  event: TChangelogEvent
): readonly TChangelogState[] =>
  CHANGELOG_STATES.filter((from) => handles(from, event));

/** True when the machine permits `from --event--> to`. */
export const canTransitionChangelog = (
  from: TChangelogState,
  to: TChangelogState
): boolean =>
  from !== to &&
  CHANGELOG_EVENTS.some((event) => stateAfter(from, event) === to);

/** Every status `event` can produce, deduplicated. */
const targetsOf = (event: TChangelogEvent): readonly TChangelogState[] => {
  const targets = new Set<TChangelogState>();
  for (const from of CHANGELOG_STATES) {
    const next = stateAfter(from, event);
    // Only a move counts: an event a state does not handle returns that state,
    // and counting it would make the target ambiguous.
    if (next !== from) {
      targets.add(next);
    }
  }
  return [...targets];
};

/** Every status `state` can move to, in declaration order. */
export const targetStatesFor = (
  state: TChangelogState
): readonly TChangelogState[] =>
  CHANGELOG_STATES.filter((to) => canTransitionChangelog(state, to));

/** Every status that moves into `to`, which is what a drain-only state lacks. */
export const inboundStatesFor = (
  to: TChangelogState
): readonly TChangelogState[] =>
  CHANGELOG_STATES.filter((from) => canTransitionChangelog(from, to));

/**
 * The single status `event` produces.
 *
 * Both events have exactly one target, so a caller that knows the event knows
 * the `SET` half of its guarded update without naming a second list.
 */
export const targetStateFor = (event: TChangelogEvent): TChangelogState => {
  const [target, ...rest] = targetsOf(event);

  if (target === undefined || rest.length > 0) {
    throw new Error(
      `Changelog event "${event}" must have exactly one target, found ${rest.length + 1}`
    );
  }

  return target;
};

/** The status a publish enters, named once so the predicates follow the graph. */
export const PUBLISHED_CHANGELOG_STATUS: TChangelogState =
  targetStateFor("publish");

/**
 * The statuses a write may name — what the two `*WriteStatus` vocabularies used
 * to restate.
 *
 * Declared literally rather than derived, because the point of the narrowing is
 * the *type*: `z.enum` and `Schema.Literals` both need a literal tuple to
 * produce `"draft" | "published"` instead of the full union. The graph still
 * owns it — `machine.test.ts` pins this list to the states with an inbound
 * edge, so adding an event that enters a state fails until the list agrees.
 */
export const CHANGELOG_WRITE_STATES = ["draft", "published"] as const;

export type TChangelogWriteState = (typeof CHANGELOG_WRITE_STATES)[number];

/**
 * The write vocabulary widened to the full status union, so membership can be
 * tested without asserting the tuple's type away at the call site.
 */
const WRITABLE_STATUSES: readonly TChangelogState[] = CHANGELOG_WRITE_STATES;

/** True when a create or update may name `status` directly. */
export const isWritableChangelogStatus = (
  status: TChangelogState
): status is TChangelogWriteState => WRITABLE_STATUSES.includes(status);

/**
 * The status to store for a write that asked for `status`.
 *
 * A drain-only status is rewritten to the status `unpublish` enters, which is
 * how `apps/web` already saved a stored `scheduled` row as the draft it
 * effectively is. Deriving it here keeps that rewrite attached to the graph
 * instead of to a cast in the collection layer.
 */
export const writableChangelogStatus = (
  status: TChangelogState
): TChangelogWriteState => {
  if (isWritableChangelogStatus(status)) {
    return status;
  }
  const unpublished = targetStateFor("unpublish");
  // SAFETY: `machine.test.ts` pins `CHANGELOG_WRITE_STATES` to the states with
  // an inbound edge, and `unpublish`'s target is one by construction.
  return isWritableChangelogStatus(unpublished) ? unpublished : "draft";
};

/** True when the entry is live. */
export const isPublishedChangelogStatus = (status: TChangelogState): boolean =>
  status === PUBLISHED_CHANGELOG_STATUS;

/**
 * True when saving `from` as `to` publishes the entry.
 *
 * This is the predicate the dashboard handler and the Public API operation both
 * recomputed before recording the publication intent and notifying
 * subscribers: a publish of an already-published entry changes nothing and must
 * not announce itself twice.
 */
export const publishesNow = (
  from: TChangelogState,
  to: TChangelogState
): boolean =>
  isPublishedChangelogStatus(to) && canTransitionChangelog(from, to);
