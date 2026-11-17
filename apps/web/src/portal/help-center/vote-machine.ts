import * as Match from "effect/Match";
import * as Schema from "effect/Schema";
import { setup } from "xstate";

/**
 * One reader's verdict on one article, as an XState machine.
 *
 * Three `useState` values held this before — the server's `mine`, a local
 * `showReason` boolean, and a `reason` string — plus React Query's
 * `isPending`. Four independently-settable values encoding four mutually
 * exclusive things a reader can be looking at, with the rules between them
 * written where they were hardest to see:
 *
 * - the reason box was only meaningful on the unhelpful branch, but nothing
 *   said so: it was a boolean that the *render* happened to guard;
 * - choosing Yes had to close it, which lived as `if (tally.mine === true)
 *   setShowReason(false)` inside a mutation callback — three frames away from
 *   the button that caused it;
 * - pressing No from a *helpful* verdict opened the box and recorded the flip
 *   in one gesture, so "the recorded verdict is unhelpful" and "the box is
 *   open" were two facts that had to change together.
 *
 * Here `promptReason` *is* "an unhelpful verdict is recorded and its reason box
 * is open". The two cannot disagree, and `CLOSE_REASON` has exactly one
 * destination because the state it leaves is what says what to go back to.
 *
 * The request is not an `invoke`, for the reason `provider-connect-machine.ts`
 * states: its failure has to be toasted where the error is known, so the hook
 * sends `SETTLED_*` after the mutation resolves. That also means these states
 * are the reader's **intent** — what an optimistic UI shows — and a reload
 * re-derives them from the server's tally. A failed write is the hook's toast
 * and React Query's `isError`, not a state here.
 */

type VoteContext = {
  /**
   * What the reader has typed about an unhelpful verdict.
   *
   * Context of the branch that owns it. `answeredHelpful` cannot carry one,
   * which is the invariant the old boolean could not express.
   */
  readonly reason: string;
};

const ContextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ reason: Schema.String })
);

const eventSchema = (type: string) =>
  Schema.toStandardSchemaV1(Schema.Struct({ type: Schema.Literal(type) }));

const SetReasonEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("SET_REASON"), value: Schema.String })
);

/** The verdict the server had stored when the tally arrived. */
export const toVoteLoadedEvent = (mine: boolean | null) =>
  Match.value(mine).pipe(
    Match.when(true, () => "LOADED_HELPFUL" as const),
    Match.when(false, () => "LOADED_UNHELPFUL" as const),
    Match.orElse(() => "LOADED_NONE" as const)
  );

export const helpCenterVoteMachine = setup({
  schemas: {
    context: ContextSchema,
    events: {
      CLOSE_REASON: eventSchema("CLOSE_REASON"),
      LOADED_HELPFUL: eventSchema("LOADED_HELPFUL"),
      LOADED_NONE: eventSchema("LOADED_NONE"),
      LOADED_UNHELPFUL: eventSchema("LOADED_UNHELPFUL"),
      SETTLED_HELPFUL: eventSchema("SETTLED_HELPFUL"),
      SETTLED_UNHELPFUL: eventSchema("SETTLED_UNHELPFUL"),
      SET_REASON: SetReasonEventSchema,
    },
  },
}).createMachine({
  context: { reason: "" },
  id: "helpCenterVote",
  initial: "loading",
  states: {
    // Until the tally arrives the reader's own verdict is unknown, and drawing
    // either button as pressed would be a guess.
    loading: {
      on: {
        LOADED_HELPFUL: { target: "answeredHelpful" },
        LOADED_NONE: { target: "asking" },
        LOADED_UNHELPFUL: { target: "answeredUnhelpful" },
        // A reader can click before the tally arrives. The verdict is still
        // theirs to record, so the settle is accepted here rather than dropped.
        SETTLED_HELPFUL: { target: "answeredHelpful" },
        SETTLED_UNHELPFUL: { target: "promptReason" },
      },
    },
    asking: {
      on: {
        SETTLED_HELPFUL: { target: "answeredHelpful" },
        SETTLED_UNHELPFUL: { target: "promptReason" },
      },
    },
    /**
     * An unhelpful verdict is recorded and its reason box is open.
     *
     * No separate event opens it. A settle arriving from anywhere other than
     * this state *produces* it, because pressing No is what opens the box — and
     * a settle arriving *here* is the reader sending what they typed, which
     * closes it. That single rule is why `OPEN_REASON` does not exist as an
     * event: it would have been a second way to reach this state, and the two
     * could disagree about whether a verdict had been recorded.
     */
    promptReason: {
      on: {
        CLOSE_REASON: { target: "answeredUnhelpful" },
        SET_REASON: {
          context: ({ event }) => ({ reason: event.value }),
        },
        SETTLED_HELPFUL: { context: { reason: "" }, target: "answeredHelpful" },
        SETTLED_UNHELPFUL: {
          context: { reason: "" },
          target: "answeredUnhelpful",
        },
      },
    },
    answeredHelpful: {
      on: {
        SETTLED_UNHELPFUL: { target: "promptReason" },
      },
    },
    answeredUnhelpful: {
      on: {
        SETTLED_HELPFUL: { target: "answeredHelpful" },
        SETTLED_UNHELPFUL: { target: "promptReason" },
      },
    },
  },
});

/**
 * The four fields of a running actor's snapshot this module reads. Structural
 * rather than `SnapshotFrom<…>` because `@xstate/react` widens the snapshot's
 * `status` for its own subscribe helpers.
 */
export type HelpCenterVoteSnapshot = {
  readonly context: { readonly reason: string };
  readonly matches: (state: string) => boolean;
};

/** What the verdict widget renders. */
export type HelpCenterVoteView = {
  /** This reader's verdict, or null before they have one. */
  readonly verdict: boolean | null;
  readonly reasonOpen: boolean;
  readonly reason: string;
  /** False while the tally is still loading, so nothing is drawn as chosen. */
  readonly ready: boolean;
};

export const toHelpCenterVoteView = (
  snapshot: HelpCenterVoteSnapshot
): HelpCenterVoteView => {
  const reasonOpen = snapshot.matches("promptReason");

  const verdict = snapshot.matches("answeredHelpful")
    ? true
    : snapshot.matches("answeredUnhelpful") || reasonOpen
      ? false
      : null;

  return {
    reason: snapshot.context.reason,
    reasonOpen,
    ready: !snapshot.matches("loading"),
    verdict,
  };
};
