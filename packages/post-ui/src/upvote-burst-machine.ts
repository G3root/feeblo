import { useMachine } from "@xstate/react";
import { useCallback } from "react";
import { setup } from "xstate";
import { z } from "zod";

/**
 * The one-shot ring a vote leaves behind, as an XState machine.
 *
 * Two `useState`s, a `useRef` and a `useEffect` held this before. The ref
 * remembered the previous `isUpvoted` so a post that was already voted on did
 * not ring on mount, the effect compared the two on every render, and a
 * `setTimeout` cleared the flag. The states were real — `bursting` means "the
 * ring is on screen and has to clear itself" — but nothing said so, and the
 * effect existed only to answer "has this already been true", which is what the
 * machine's initial state answers instead.
 *
 * The event is the **press**, not the prop. `onToggle` reports whether the
 * click actually cast a vote — a guest who is sent to the sign-in dialog, a
 * disabled post, or a retry that finds the row already matching did not — so
 * the ring confirms the action the visitor took rather than a change to a value
 * that may have arrived from somebody else's vote through the live query.
 *
 * XState 6 has no `guard` key: a transition is a target string, a
 * `{ target, context }` patch, or a function returning one. `CAST` in
 * `bursting` carries `reenter: true`, because a same-target transition is not a
 * re-entry on its own — without it the second press would inherit the first
 * ring's remaining time and the ring would be swallowed.
 */

/**
 * How long the ring draws for. Matches `--animate-vote-burst` in the shared
 * theme; the state is held a hair longer than the animation so the element
 * cannot be removed mid-frame.
 */
const BURST_DURATION_MS = 420;

const CastEventSchema = z.object({ type: z.literal("CAST") });

export const upvoteBurstMachine = setup({
  schemas: {
    events: { CAST: CastEventSchema },
  },
}).createMachine({
  id: "upvoteBurst",
  initial: "idle",
  states: {
    idle: {
      on: { CAST: { target: "bursting" } },
    },
    bursting: {
      after: { [BURST_DURATION_MS]: { target: "idle" } },
      on: { CAST: { reenter: true, target: "bursting" } },
    },
  },
});

/** What a trigger renders: whether the ring is on screen, and how to fire it. */
export type VoteBurst = {
  readonly bursting: boolean;
  /** Called once per press that cast a vote, by the trigger's click handler. */
  readonly cast: () => void;
};

/**
 * The adapter between React's render cycle and the machine.
 *
 * `cast` is called from a handler, never from an effect: the press is an event
 * and the machine has a state for it, so there is nothing to synchronise after
 * paint.
 */
export function useVoteBurst(): VoteBurst {
  const [snapshot, send] = useMachine(upvoteBurstMachine);

  const cast = useCallback(() => {
    send({ type: "CAST" });
  }, [send]);

  return { bursting: snapshot.matches("bursting"), cast };
}
