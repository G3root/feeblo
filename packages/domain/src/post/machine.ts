import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { isUnhandled, transition } from "xstate";

/**
 * The two lifecycles of one post, as XState machines.
 *
 * A post carries three timestamps and a pointer — `archivedAt`, `lockedAt`,
 * `mergedIntoPostId`, `mergedAt` — and the rules that relate them were spread
 * across the schema's CHECK constraints, `isUnlocked`/`isUnlockedPublic` in the
 * repository, the merge and unmerge guards, the delete-survivor guard, the
 * public-visibility SQL, and two identical copies of
 * `requireNotMergedActivityState`. "May this post be merged?" was answerable
 * only by reading four of those.
 *
 * There are two graphs, not one, because the two questions are independent:
 *
 * - **Presence** (`listed | archived | merged`) answers "where does this post
 *   show up". `merged` dominates: the row also carries `archivedAt`, which is
 *   what `post_merged_rows_must_be_archived_chk` enforces, so `merged` is a
 *   presence state and not a fourth flag.
 * - **Engagement** (`open | locked`) answers "may people still comment and
 *   vote". A locked post is still listed, still archived, and can still be
 *   merged; a merged post can be locked and unmerged back to `locked`, which is
 *   exactly what the columns already do (`unmerge` clears `archivedAt`,
 *   `mergedAt` and `mergedIntoPostId` and leaves `lockedAt` alone).
 *
 * Flattening them into one six-state product was the alternative. It was
 * rejected because `merge` and `unmerge` preserve the lock bit, so each would
 * have had two targets and `presenceTargetStateFor` — the function the guarded
 * `UPDATE`s are built from — would have had no single answer. Two graphs keep
 * every event single-target, which is what makes the derivation below
 * mechanical.
 *
 * The machines are definitions, not actors: the database row is the
 * authoritative state, and a process that restarts must resume from it.
 */

// ---------------------------------------------------------------------------
// Presence: where the post shows up
// ---------------------------------------------------------------------------

export const POST_PRESENCE_STATES = ["listed", "archived", "merged"] as const;

export type TPostPresence = (typeof POST_PRESENCE_STATES)[number];

export const POST_PRESENCE_EVENTS = [
  "archive",
  "unarchive",
  "merge",
  "unmerge",
] as const;

export type TPostPresenceEvent = (typeof POST_PRESENCE_EVENTS)[number];

export const postPresenceMachine = setupEffect({
  schemas: {
    events: {
      archive: Schema.Struct({ type: Schema.Literal("archive") }),
      merge: Schema.Struct({ type: Schema.Literal("merge") }),
      unarchive: Schema.Struct({ type: Schema.Literal("unarchive") }),
      unmerge: Schema.Struct({ type: Schema.Literal("unmerge") }),
    },
  },
}).createMachine({
  context: {},
  id: "postPresence",
  initial: "listed",
  states: {
    // On its board and in every list. The only state a post can be merged
    // from or into: an archived post is not a merge endpoint, which is what
    // `archived` having no `merge` edge says.
    listed: {
      on: {
        archive: { target: "archived" },
        merge: { target: "merged" },
      },
    },
    // Hidden from lists, still editable and still engageable. Unarchiving is
    // the only move out; a merged post cannot be "unarchived" back into the
    // board without being unmerged first, which is why `merge` has no edge
    // from here.
    archived: {
      on: {
        unarchive: { target: "listed" },
      },
    },
    // Superseded by another post. The row also carries `archivedAt`
    // (`post_merged_rows_must_be_archived_chk`), so this state is the
    // presence, not a flag on top of it. Unmerging restores `listed`.
    merged: {
      on: {
        unmerge: { target: "listed" },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Engagement: whether people may still interact
// ---------------------------------------------------------------------------

export const POST_ENGAGEMENT_STATES = ["open", "locked"] as const;

export type TPostEngagement = (typeof POST_ENGAGEMENT_STATES)[number];

export const POST_ENGAGEMENT_EVENTS = ["lock", "unlock"] as const;

export type TPostEngagementEvent = (typeof POST_ENGAGEMENT_EVENTS)[number];

export const postEngagementMachine = setupEffect({
  schemas: {
    events: {
      lock: Schema.Struct({ type: Schema.Literal("lock") }),
      unlock: Schema.Struct({ type: Schema.Literal("unlock") }),
    },
  },
}).createMachine({
  context: {},
  id: "postEngagement",
  initial: "open",
  states: {
    // Comments, votes and reactions are accepted.
    open: {
      on: {
        lock: { target: "locked" },
      },
    },
    // Comments, votes and reactions are refused; the post is still readable.
    locked: {
      on: {
        unlock: { target: "open" },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Graph queries
// ---------------------------------------------------------------------------

/** A snapshot for a persisted presence, built without starting an actor. */
const presenceSnapshotFor = (state: TPostPresence) =>
  postPresenceMachine.resolveState({ context: {}, value: state });

/** A snapshot for a persisted engagement, built without starting an actor. */
const engagementSnapshotFor = (state: TPostEngagement) =>
  postEngagementMachine.resolveState({ context: {}, value: state });

/** True when the presence machine handles `event` at all. */
const presenceHandles = (
  state: TPostPresence,
  event: TPostPresenceEvent
): boolean => {
  const before = presenceSnapshotFor(state);
  return !isUnhandled(
    before,
    transition(postPresenceMachine, before, { type: event })
  );
};

/** True when the engagement machine handles `event` at all. */
const engagementHandles = (
  state: TPostEngagement,
  event: TPostEngagementEvent
): boolean => {
  const before = engagementSnapshotFor(state);
  return !isUnhandled(
    before,
    transition(postEngagementMachine, before, { type: event })
  );
};

/** The presence `event` produces from `state`, which is `state` if refused. */
const presenceAfter = (
  state: TPostPresence,
  event: TPostPresenceEvent
): TPostPresence => {
  const [next] = transition(postPresenceMachine, presenceSnapshotFor(state), {
    type: event,
  });
  // SAFETY: the machine is flat — every state and target is one of the three
  // presence states — and `machine.test.ts` walks the whole graph rather than
  // trusting this comment.
  return next.value as TPostPresence;
};

/** The engagement `event` produces from `state`, which is `state` if refused. */
const engagementAfter = (
  state: TPostEngagement,
  event: TPostEngagementEvent
): TPostEngagement => {
  const [next] = transition(
    postEngagementMachine,
    engagementSnapshotFor(state),
    { type: event }
  );
  // SAFETY: as above, over the two engagement states.
  return next.value as TPostEngagement;
};

/** True when the presence machine permits `from --event--> to`. */
export const canTransitionPostPresence = (
  from: TPostPresence,
  to: TPostPresence
): boolean =>
  from !== to &&
  POST_PRESENCE_EVENTS.some((event) => presenceAfter(from, event) === to);

/** True when the engagement machine permits `from --event--> to`. */
export const canTransitionPostEngagement = (
  from: TPostEngagement,
  to: TPostEngagement
): boolean =>
  from !== to &&
  POST_ENGAGEMENT_EVENTS.some((event) => engagementAfter(from, event) === to);

/** Every presence from which `event` moves the post. */
export const presenceSourceStatesFor = (
  event: TPostPresenceEvent
): readonly TPostPresence[] =>
  POST_PRESENCE_STATES.filter((from) => presenceHandles(from, event));

/** Every engagement from which `event` moves the post. */
export const engagementSourceStatesFor = (
  event: TPostEngagementEvent
): readonly TPostEngagement[] =>
  POST_ENGAGEMENT_STATES.filter((from) => engagementHandles(from, event));

/** Every presence `event` can produce, deduplicated. */
const presenceTargetsOf = (
  event: TPostPresenceEvent
): readonly TPostPresence[] => {
  const targets = new Set<TPostPresence>();
  for (const from of POST_PRESENCE_STATES) {
    const next = presenceAfter(from, event);
    // Only a move counts: an event a state does not handle returns that state,
    // and counting it would make the target ambiguous.
    if (next !== from) {
      targets.add(next);
    }
  }
  return [...targets];
};

/** Every engagement `event` can produce, deduplicated. */
const engagementTargetsOf = (
  event: TPostEngagementEvent
): readonly TPostEngagement[] => {
  const targets = new Set<TPostEngagement>();
  for (const from of POST_ENGAGEMENT_STATES) {
    const next = engagementAfter(from, event);
    if (next !== from) {
      targets.add(next);
    }
  }
  return [...targets];
};

/**
 * The single presence `event` produces.
 *
 * Every presence event has exactly one target, so a caller that knows the event
 * knows the `SET` half of its guarded update.
 */
export const presenceTargetStateFor = (
  event: TPostPresenceEvent
): TPostPresence => {
  const [target, ...rest] = presenceTargetsOf(event);

  if (target === undefined || rest.length > 0) {
    throw new Error(
      `Post presence event "${event}" must have exactly one target, found ${rest.length + 1}`
    );
  }

  return target;
};

/** The single engagement `event` produces. */
export const engagementTargetStateFor = (
  event: TPostEngagementEvent
): TPostEngagement => {
  const [target, ...rest] = engagementTargetsOf(event);

  if (target === undefined || rest.length > 0) {
    throw new Error(
      `Post engagement event "${event}" must have exactly one target, found ${rest.length + 1}`
    );
  }

  return target;
};

// ---------------------------------------------------------------------------
// Named states, so no caller spells one out
// ---------------------------------------------------------------------------

/** The presence a post enters when archived. */
export const ARCHIVED_POST_PRESENCE: TPostPresence =
  presenceTargetStateFor("archive");

/** The presence a post enters when merged into another post. */
export const MERGED_POST_PRESENCE: TPostPresence =
  presenceTargetStateFor("merge");

/** The presence a post returns to when unmerged or unarchived. */
export const LISTED_POST_PRESENCE: TPostPresence =
  presenceTargetStateFor("unmerge");

/** The engagement a post enters when locked. */
export const LOCKED_POST_ENGAGEMENT: TPostEngagement =
  engagementTargetStateFor("lock");

/** The engagement a post is in while it accepts interaction. */
export const OPEN_POST_ENGAGEMENT: TPostEngagement =
  engagementTargetStateFor("unlock");

// ---------------------------------------------------------------------------
// Reading a row back
// ---------------------------------------------------------------------------

/** The columns a presence state is derived from. */
export type PostPresenceFields = {
  readonly archivedAt: Date | null;
  readonly mergedIntoPostId: string | null;
};

/** The columns an engagement state is derived from. */
export type PostEngagementFields = {
  readonly lockedAt: Date | null;
};

/**
 * The presence a stored row is in.
 *
 * `merged` is tested first because a merged row is also archived: the CHECK
 * constraint requires it, so testing `archivedAt` first would report every
 * merged post as `archived`.
 */
export const presenceOf = (row: PostPresenceFields): TPostPresence =>
  row.mergedIntoPostId !== null
    ? MERGED_POST_PRESENCE
    : row.archivedAt !== null
      ? ARCHIVED_POST_PRESENCE
      : LISTED_POST_PRESENCE;

/** The engagement a stored row is in. */
export const engagementOf = (row: PostEngagementFields): TPostEngagement =>
  row.lockedAt !== null ? LOCKED_POST_ENGAGEMENT : OPEN_POST_ENGAGEMENT;

/** The engagement a lock flag names, so a write compares states, not booleans. */
export const engagementForLock = (locked: boolean): TPostEngagement =>
  locked ? LOCKED_POST_ENGAGEMENT : OPEN_POST_ENGAGEMENT;

// ---------------------------------------------------------------------------
// Derived predicates
// ---------------------------------------------------------------------------

/** True when the post has been superseded by another post. */
export const isMergedPostPresence = (presence: TPostPresence): boolean =>
  presence === MERGED_POST_PRESENCE;

/**
 * True when a stored row is in the merged presence.
 *
 * A type guard so a caller that has just proved the post is merged also gets the
 * survivor id as a string, instead of re-testing the column — which is the
 * hand-written check this graph exists to replace.
 */
export const isMergedPostRow = (
  row: PostPresenceFields
): row is PostPresenceFields & { readonly mergedIntoPostId: string } =>
  isMergedPostPresence(presenceOf(row));

/** True when the post has been archived but not merged. */
export const isArchivedPostPresence = (presence: TPostPresence): boolean =>
  presence === ARCHIVED_POST_PRESENCE;

/**
 * The presences in which the post is still its own page: everything except the
 * merge target.
 *
 * "Not merged" is what `isUnlocked` and the public-visibility predicate both
 * need, and neither may hide an archived post: archiving removes a post from
 * lists, not from the page people comment on.
 */
export const UNSUPERSEDED_POST_PRESENCE_STATES: readonly TPostPresence[] =
  POST_PRESENCE_STATES.filter((presence) => !isMergedPostPresence(presence));
