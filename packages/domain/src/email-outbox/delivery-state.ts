import type { TEmailDeliveryState } from "@feeblo/db/validation-schema/email";

const EMPTY_STATES: readonly TEmailDeliveryState[] = [];

const transitionTargets = {
  accepted: ["delivered", "deferred", "bounced", "failed"],
  bounced: EMPTY_STATES,
  deferred: ["sending", "expired", "failed", "paused_by_plan", "suppressed"],
  delivered: EMPTY_STATES,
  expired: EMPTY_STATES,
  failed: EMPTY_STATES,
  paused_by_plan: ["queued", "expired"],
  queued: ["sending", "expired", "failed", "paused_by_plan", "suppressed"],
  sending: [
    "accepted",
    "delivered",
    "deferred",
    "bounced",
    "failed",
    "expired",
    "paused_by_plan",
    "suppressed",
  ],
  suppressed: EMPTY_STATES,
} satisfies Readonly<
  Record<TEmailDeliveryState, readonly TEmailDeliveryState[]>
>;
// SAFETY: transitionTargets is exhaustively keyed by TEmailDeliveryState, so
// Object.keys returns only TEmailDeliveryState values.
const deliveryStates = Object.keys(
  transitionTargets
) as readonly TEmailDeliveryState[];

/** Returns whether a delivery may move between two persisted lifecycle states. */
export const canTransitionDelivery = (
  from: TEmailDeliveryState,
  to: TEmailDeliveryState
): boolean => {
  // SAFETY: transitionTargets indexes every TEmailDeliveryState key.
  const targets = transitionTargets[from] as readonly TEmailDeliveryState[];
  return targets.includes(to);
};

/** Persisted states from which a guarded SQL update may enter the target state. */
export const deliverySourceStatesFor = (
  to: TEmailDeliveryState
): readonly TEmailDeliveryState[] =>
  deliveryStates.filter((from) => canTransitionDelivery(from, to));

/** Terminal delivery states are safe no-ops when a workflow is replayed. */
export const isTerminalDeliveryState = (state: TEmailDeliveryState): boolean =>
  transitionTargets[state].length === 0;
