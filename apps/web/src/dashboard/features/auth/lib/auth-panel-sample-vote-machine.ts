import { setup } from "xstate";
import { z } from "zod";

/**
 * The sample vote that lands on the auth panel's board, as an XState machine.
 *
 * `useState` plus an effect with a `setTimeout`, a `matchMedia` check and a
 * cleanup held this before. That is a two-state lifecycle — `settling` while
 * the board is still arriving, `voted` once the sample vote has landed — and the
 * effect was its only documentation. The panel exists to show the vote being
 * cast, so which of the two it is in is the whole point of the component.
 *
 * Reduced motion is not a state here, on purpose. What moves is the ring and
 * the number's rise, and both are CSS: the ring is `motion-reduce:hidden` and
 * the number is `motion-safe:animate-rise-in`. The transition itself is a
 * number changing, which is not motion, so the machine adding a timer is
 * correct for every visitor — a media query read from an effect would be a
 * second, slower copy of what the stylesheet already decides.
 *
 * The delay is longer than any transition in the product on purpose: this is
 * decoration beside a form, and it should be noticed only if you look.
 */
export const SAMPLE_VOTE_DELAY_MS = 1500;

const SettleEventSchema = z.object({ type: z.literal("SETTLE") });

export const authPanelSampleVoteMachine = setup({
  schemas: {
    events: { SETTLE: SettleEventSchema },
  },
}).createMachine({
  id: "authPanelSampleVote",
  initial: "settling",
  states: {
    settling: {
      after: { [SAMPLE_VOTE_DELAY_MS]: { target: "voted" } },
      // Spelled out so the machine also accepts an explicit settle: a test does
      // not have to wait 1500ms to reach the state the panel is famous for.
      on: { SETTLE: { target: "voted" } },
    },
    voted: {},
  },
});
