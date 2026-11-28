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
 * The tally is context rather than a parallel `useState` because it has the same
 * problem: the read and the write both answer with it, and one of them is
 * newer. `SETTLED_*` carries the write's answer, `LOADED_*` carries the read's,
 * and the transitions below say which wins — the write, in every state that
 * accepts it, because a settle is the reader's own press and the read it
 * replaces was already on screen. An event the state does not handle (a read
 * that lands after a press) is dropped instead of overwriting the numbers.
 *
 * The request is not an `invoke`, for the reason `provider-connect-machine.ts`
 * states: its failure has to be toasted where the error is known, so the hook
 * sends `SETTLED_*` after the mutation resolves. That also means these states
 * are the reader's **intent** — what an optimistic UI shows — and a reload
 * re-derives them from the server's tally. A failed write is the hook's toast
 * and React Query's `isError`, not a state here.
 */

/** The verdict tallies and this reader's verdict, as the RPC returns them. */
const TallySchema = Schema.Struct({
  helpfulCount: Schema.Finite,
  notHelpfulCount: Schema.Finite,
  mine: Schema.NullOr(Schema.Boolean),
});

export type HelpCenterTally = Schema.Schema.Type<typeof TallySchema>;

const ContextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    reason: Schema.String,
    tally: Schema.NullOr(TallySchema),
  })
);

const eventSchema = (type: string) =>
  Schema.toStandardSchemaV1(Schema.Struct({ type: Schema.Literal(type) }));

/** An event that brings a tally: either the read's or the write's answer. */
const tallyEventSchema = (type: string) =>
  Schema.toStandardSchemaV1(
    Schema.Struct({ tally: TallySchema, type: Schema.Literal(type) })
  );

const SetReasonEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("SET_REASON"), value: Schema.String })
);

/** The part of a tally event this module reads. */
type TallyEvent = { readonly tally: HelpCenterTally };

/**
 * A transition into `target` that also adopts the tally the event carries.
 *
 * Named because every move between the answered states has to do the same two
 * things, and a transition that forgot the second would draw the new verdict
 * beside the previous one's counts.
 */
const tallyTo = <Target extends string>(target: Target) => ({
  context: ({ event }: { readonly event: TallyEvent }) => ({
    tally: event.tally,
  }),
  target,
});

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
      LOADED_HELPFUL: tallyEventSchema("LOADED_HELPFUL"),
      LOADED_NONE: tallyEventSchema("LOADED_NONE"),
      LOADED_UNHELPFUL: tallyEventSchema("LOADED_UNHELPFUL"),
      RETRY: eventSchema("RETRY"),
      SETTLED_HELPFUL: tallyEventSchema("SETTLED_HELPFUL"),
      SETTLED_UNHELPFUL: tallyEventSchema("SETTLED_UNHELPFUL"),
      SET_REASON: SetReasonEventSchema,
      TALLY_FAILED: eventSchema("TALLY_FAILED"),
    },
  },
}).createMachine({
  context: { reason: "", tally: null },
  id: "helpCenterVote",
  initial: "loading",
  states: {
    // Until the tally arrives the reader's own verdict is unknown, and drawing
    // either button as pressed would be a guess.
    loading: {
      on: {
        LOADED_HELPFUL: tallyTo("answeredHelpful"),
        LOADED_NONE: tallyTo("asking"),
        LOADED_UNHELPFUL: tallyTo("answeredUnhelpful"),
        // A reader can click before the tally arrives. The verdict is still
        // theirs to record, so the settle is accepted here rather than dropped.
        SETTLED_HELPFUL: tallyTo("answeredHelpful"),
        SETTLED_UNHELPFUL: tallyTo("promptReason"),
        TALLY_FAILED: { target: "failed" },
      },
    },
    /**
     * The tally could not be read.
     *
     * Not the same as "no verdict": the buttons cannot be drawn from an answer
     * that never arrived, and pressing one would cast blind. The reader gets a
     * retry instead, and a late-arriving loaded tally — a refresh that succeeds
     * without the button being pressed — is still adopted, because the server's
     * answer is the state this machine was only guessing at.
     *
     * `TALLY_FAILED` is a no-op here so a repeated failed refresh cannot loop
     * the machine back into `loading` and hide the row while it is still down.
     */
    failed: {
      on: {
        LOADED_HELPFUL: tallyTo("answeredHelpful"),
        LOADED_NONE: tallyTo("asking"),
        LOADED_UNHELPFUL: tallyTo("answeredUnhelpful"),
        RETRY: { target: "loading" },
        TALLY_FAILED: {},
      },
    },
    asking: {
      on: {
        SETTLED_HELPFUL: tallyTo("answeredHelpful"),
        SETTLED_UNHELPFUL: tallyTo("promptReason"),
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
        SETTLED_HELPFUL: {
          context: ({ event }: { readonly event: TallyEvent }) => ({
            reason: "",
            tally: event.tally,
          }),
          target: "answeredHelpful",
        },
        SETTLED_UNHELPFUL: {
          context: ({ event }: { readonly event: TallyEvent }) => ({
            reason: "",
            tally: event.tally,
          }),
          target: "answeredUnhelpful",
        },
      },
    },
    answeredHelpful: {
      on: {
        // A second Yes is a write like any other: it returns the counts as they
        // are now, so the state stays put and only the numbers move. Without
        // this the counts would stay frozen on the first read — nothing else
        // updates them, because the invalidated read is only adopted once.
        SETTLED_HELPFUL: tallyTo("answeredHelpful"),
        SETTLED_UNHELPFUL: tallyTo("promptReason"),
      },
    },
    answeredUnhelpful: {
      on: {
        SETTLED_HELPFUL: tallyTo("answeredHelpful"),
        SETTLED_UNHELPFUL: tallyTo("promptReason"),
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
  readonly context: {
    readonly reason: string;
    readonly tally: HelpCenterTally | null;
  };
  readonly matches: (state: string) => boolean;
};

/** What the verdict widget renders. */
export type HelpCenterVoteView = {
  /** This reader's verdict, or null before they have one. */
  readonly verdict: boolean | null;
  readonly reasonOpen: boolean;
  readonly reason: string;
  /**
   * False while the tally is loading or failed, so nothing is drawn as chosen
   * from an answer the widget does not have.
   */
  readonly ready: boolean;
  /** True when the tally could not be read; the buttons are replaced by retry. */
  readonly failed: boolean;
  /**
   * The counts to draw beside the buttons.
   *
   * From the machine's context rather than a second read in the component: the
   * read and the write both carry a tally, and which one is current is a state
   * question the transitions above answer once.
   */
  readonly counts: {
    readonly helpful: number;
    readonly notHelpful: number;
  };
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
    counts: {
      helpful: snapshot.context.tally?.helpfulCount ?? 0,
      notHelpful: snapshot.context.tally?.notHelpfulCount ?? 0,
    },
    failed: snapshot.matches("failed"),
    reason: snapshot.context.reason,
    reasonOpen,
    ready: !snapshot.matches("loading") && !snapshot.matches("failed"),
    verdict,
  };
};
