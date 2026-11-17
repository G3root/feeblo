import {
  HELP_CENTER_ARTICLE_STATES,
  HELP_CENTER_ARTICLE_WRITE_STATES,
  type THelpCenterArticleState,
  type THelpCenterArticleWriteState,
} from "@feeblo/domain-contracts/help-center-article";
import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { isUnhandled, transition } from "xstate";

/**
 * The lifecycle of one help center article, as an XState machine.
 *
 * Three states, declared once. `HELP_CENTER_ARTICLE_STATES` in
 * `@feeblo/domain-contracts` is the column's vocabulary and this graph's states
 * are that same constant, so the database type, the RPC schemas and the edges
 * below cannot disagree — unlike the changelog's arrangement, where the
 * `pgEnum` and the machine are two lists that a test has to compare.
 *
 * - `draft` — editable and invisible to readers.
 * - `published` — what the portal serves.
 * - `archived` — withdrawn from the documentation, but the inbound link still
 *   resolves to a page that says so. This is the reader-visible answer to "the
 *   feature this described was removed", and it is deliberately not a delete:
 *   a hard delete would 404 every link a customer's support team ever pasted.
 *
 * `archived` is reachable only from `published`, and `restore` returns it to
 * `draft` rather than straight back to `published` — an archived article has
 * to be re-read before it becomes documentation again. Two things are not in
 * the graph:
 *
 * - **Creation.** A create names its initial state and there is no prior row to
 *   move from, so `HELP_CENTER_ARTICLE_WRITE_STATES` is the set of states a
 *   write may name, which is the same fact stated once.
 * - **`publishedAt`.** The column records when an article went live; it is
 *   metadata of the non-draft states, not a state of its own. Folding it in
 *   would make the machine reject a write the dashboard produces whenever an
 *   editor publishes without picking a date.
 */
export const HELP_CENTER_ARTICLE_EVENTS = [
  "publish",
  "unpublish",
  "archive",
  "restore",
] as const;

/**
 * Re-exported so a reader of this module finds the graph's state list beside
 * its edges rather than in a different package.
 */
export { HELP_CENTER_ARTICLE_STATES, HELP_CENTER_ARTICLE_WRITE_STATES };

export type THelpCenterArticleEvent =
  (typeof HELP_CENTER_ARTICLE_EVENTS)[number];

export const helpCenterArticleMachine = setupEffect({
  schemas: {
    events: {
      publish: Schema.Struct({ type: Schema.Literal("publish") }),
      unpublish: Schema.Struct({ type: Schema.Literal("unpublish") }),
      archive: Schema.Struct({ type: Schema.Literal("archive") }),
      restore: Schema.Struct({ type: Schema.Literal("restore") }),
    },
  },
}).createMachine({
  context: {},
  id: "helpCenterArticle",
  initial: "draft",
  states: {
    draft: {
      on: {
        publish: { target: "published" },
      },
    },
    published: {
      on: {
        unpublish: { target: "draft" },
        archive: { target: "archived" },
      },
    },
    archived: {
      on: {
        restore: { target: "draft" },
      },
    },
  },
});

/** A snapshot for a stored status, built without starting an actor. */
const snapshotFor = (state: THelpCenterArticleState) =>
  helpCenterArticleMachine.resolveState({ context: {}, value: state });

/**
 * The state the machine lands in after `event` from `state`.
 *
 * An event a state does not handle returns the state it started in, which is
 * what makes `canTransitionHelpCenterArticle` a two-state comparison: the
 * machine has no self-transitions, so "unchanged" means "rejected".
 */
const stateAfter = (
  state: THelpCenterArticleState,
  event: THelpCenterArticleEvent
): THelpCenterArticleState => {
  const [next] = transition(helpCenterArticleMachine, snapshotFor(state), {
    type: event,
  });

  // SAFETY: the machine is flat — every state is a top-level string and every
  // target is one of the three declared states — so a `StateValue` read from it
  // is always a status. `machine.test.ts` walks the whole graph rather than
  // trusting this comment.
  return next.value as THelpCenterArticleState;
};

/** True when the machine handles `event` at all. */
const handles = (
  state: THelpCenterArticleState,
  event: THelpCenterArticleEvent
): boolean => {
  const before = snapshotFor(state);

  return !isUnhandled(
    before,
    transition(helpCenterArticleMachine, before, { type: event })
  );
};

/** Every state from which `event` moves the article. */
export const sourceStatesFor = (
  event: THelpCenterArticleEvent
): readonly THelpCenterArticleState[] =>
  HELP_CENTER_ARTICLE_STATES.filter((from) => handles(from, event));

/** True when the machine permits `from --event--> to`. */
export const canTransitionHelpCenterArticle = (
  from: THelpCenterArticleState,
  to: THelpCenterArticleState
): boolean =>
  from !== to &&
  HELP_CENTER_ARTICLE_EVENTS.some((event) => stateAfter(from, event) === to);

/** Every state `state` can move to, in declaration order. */
export const targetStatesFor = (
  state: THelpCenterArticleState
): readonly THelpCenterArticleState[] =>
  HELP_CENTER_ARTICLE_STATES.filter((to) =>
    canTransitionHelpCenterArticle(state, to)
  );

/** Every state that moves into `to`. */
export const inboundStatesFor = (
  to: THelpCenterArticleState
): readonly THelpCenterArticleState[] =>
  HELP_CENTER_ARTICLE_STATES.filter((from) =>
    canTransitionHelpCenterArticle(from, to)
  );

/**
 * The single state `event` produces.
 *
 * Every event has exactly one target, so a caller that knows the event knows
 * the `SET` half of its guarded update without naming a second list.
 */
export const targetStateFor = (
  event: THelpCenterArticleEvent
): THelpCenterArticleState => {
  const targets = new Set<THelpCenterArticleState>();

  for (const from of HELP_CENTER_ARTICLE_STATES) {
    const next = stateAfter(from, event);

    // Only a move counts: an event a state does not handle returns that state,
    // and counting it would make the target ambiguous.
    if (next !== from) {
      targets.add(next);
    }
  }

  const [target, ...rest] = [...targets];

  if (target === undefined || rest.length > 0) {
    throw new Error(
      `Help center article event "${event}" must have exactly one target, found ${rest.length + 1}`
    );
  }

  return target;
};

/** The state a publish enters, named once so the predicates follow the graph. */
export const PUBLISHED_HELP_CENTER_ARTICLE_STATE: THelpCenterArticleState =
  targetStateFor("publish");

/**
 * The state an archive enters, named once for the same reason.
 *
 * The view paths ask this to decide whether an article is readable at all:
 * `published` is served, `archived` is served as a tombstone, `draft` is 404.
 */
export const ARCHIVED_HELP_CENTER_ARTICLE_STATE: THelpCenterArticleState =
  targetStateFor("archive");

/** True when the article is the documentation the portal serves. */
export const isPublishedHelpCenterArticle = (
  state: THelpCenterArticleState
): boolean => state === PUBLISHED_HELP_CENTER_ARTICLE_STATE;

/** True when nobody but a member may see the article. */
export const isDraftHelpCenterArticle = (
  state: THelpCenterArticleState
): boolean => state === "draft";

/** True when the article is a withdrawn page whose link still resolves. */
export const isArchivedHelpCenterArticle = (
  state: THelpCenterArticleState
): boolean => state === ARCHIVED_HELP_CENTER_ARTICLE_STATE;

/**
 * True when a reader may open the article.
 *
 * Served and withdrawn both open; a draft is not a page. This is the one
 * predicate the repository's public filters and the portal's route guard ask,
 * so a new state cannot be readable on one surface and 404 on the other.
 */
export const isHelpCenterArticleReadable = (
  state: THelpCenterArticleState
): boolean =>
  isPublishedHelpCenterArticle(state) || isArchivedHelpCenterArticle(state);

/**
 * True when saving `from` as `to` takes the article live.
 *
 * The dashboard uses it to decide whether a save is a publication — which is
 * when `publishedAt` is stamped and a republish of an already-live article must
 * not move the date readers see.
 */
export const publishesNow = (
  from: THelpCenterArticleState,
  to: THelpCenterArticleState
): boolean =>
  isPublishedHelpCenterArticle(to) && canTransitionHelpCenterArticle(from, to);

/**
 * True when a write names a non-draft state without a publication date.
 *
 * The database enforces the same rule
 * (`help_center_article_published_at_chk`), which is why the write path asks
 * this before the insert rather than letting a constraint violation surface as
 * a 500. `archived` is included: archiving is only reachable from published, so
 * an archived row always has a date.
 */
export const needsPublicationTimestamp = (state: THelpCenterArticleState) =>
  !isDraftHelpCenterArticle(state);

/** The write vocabulary widened to the full state union, for membership tests. */
const WRITABLE_STATES: readonly THelpCenterArticleState[] =
  HELP_CENTER_ARTICLE_WRITE_STATES;

/** True when a create or update may name `state` directly. */
export const isWritableHelpCenterArticleState = (
  state: THelpCenterArticleState
): state is THelpCenterArticleWriteState => WRITABLE_STATES.includes(state);

/**
 * The state to store for a row whose stored value arrived as a bare string.
 *
 * The dashboard's collection row types `status` as `string` because it is a
 * database column, while the write RPC takes the state union. Narrowing here
 * rather than casting at the call site means a stored value the graph does not
 * know is refused by name instead of being sent to the server to fail.
 */
export const writableHelpCenterArticleState = (
  state: string
): THelpCenterArticleWriteState => {
  const match = HELP_CENTER_ARTICLE_STATES.find(
    (candidate) => candidate === state
  );

  if (match === undefined) {
    throw new Error(`Unknown help center article state "${state}"`);
  }

  return match;
};
