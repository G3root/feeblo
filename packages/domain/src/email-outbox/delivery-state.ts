import type { EmailDeliveryState } from "./schema";

const transitionTargets: Readonly<
  Record<EmailDeliveryState, readonly EmailDeliveryState[]>
> = {
  accepted: ["delivered", "deferred", "bounced", "failed"],
  bounced: [],
  deferred: ["sending", "expired", "failed", "paused_by_plan", "suppressed"],
  delivered: [],
  expired: [],
  failed: [],
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
  suppressed: [],
};

const deliveryStates = [
  "accepted",
  "bounced",
  "deferred",
  "delivered",
  "expired",
  "failed",
  "paused_by_plan",
  "queued",
  "sending",
  "suppressed",
] as const satisfies readonly EmailDeliveryState[];

/** Returns whether a delivery may move between two persisted lifecycle states. */
export const canTransitionDelivery = (
  from: EmailDeliveryState,
  to: EmailDeliveryState
): boolean => transitionTargets[from].includes(to);

/** Persisted states from which a guarded SQL update may enter the target state. */
export const deliverySourceStatesFor = (
  to: EmailDeliveryState
): readonly EmailDeliveryState[] =>
  deliveryStates.filter((from) => canTransitionDelivery(from, to));

/** Terminal delivery states are safe no-ops when a workflow is replayed. */
export const isTerminalDeliveryState = (state: EmailDeliveryState): boolean =>
  transitionTargets[state].length === 0;
