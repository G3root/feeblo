import type { EmailDeliveryState } from "./schema";

const transitionTargets: Readonly<
  Record<EmailDeliveryState, ReadonlyArray<EmailDeliveryState>>
> = {
  accepted: ["delivered", "deferred", "bounced", "failed"],
  bounced: [],
  deferred: ["sending", "expired", "paused_by_plan", "suppressed"],
  delivered: [],
  expired: [],
  failed: [],
  paused_by_plan: ["queued", "expired"],
  queued: ["sending", "expired", "paused_by_plan", "suppressed"],
  sending: [
    "accepted",
    "delivered",
    "deferred",
    "bounced",
    "failed",
    "suppressed",
  ],
  suppressed: [],
};

/** Returns whether a delivery may move between two persisted lifecycle states. */
export const canTransitionDelivery = (
  from: EmailDeliveryState,
  to: EmailDeliveryState
): boolean => transitionTargets[from].includes(to);

/** Terminal delivery states are safe no-ops when a workflow is replayed. */
export const isTerminalDeliveryState = (
  state: EmailDeliveryState
): boolean => transitionTargets[state].length === 0;
