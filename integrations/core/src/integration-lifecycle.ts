import type {
  IntegrationConnectionLifecycleStatus,
  IntegrationDeliveryState,
} from "./integration-contracts";

/** Tests whether a connection lifecycle transition is legal before persistence. */
export const canTransitionIntegrationConnectionLifecycle = ({
  from,
  to,
}: {
  readonly from: IntegrationConnectionLifecycleStatus;
  readonly to: IntegrationConnectionLifecycleStatus;
}): boolean => {
  if (from === to) {
    return false;
  }

  return (
    (from === "connecting" && to === "active") ||
    ((from === "active" || from === "paused") &&
      (to === "paused" ||
        to === "active" ||
        to === "reauth_required" ||
        to === "disconnecting")) ||
    (from === "reauth_required" && to === "disconnecting") ||
    (from === "disconnecting" &&
      (to === "disconnected" || to === "revocation_unconfirmed")) ||
    (from === "disconnected" && (to === "active" || to === "archived"))
  );
};

/** Tests whether a delivery state change preserves lease and retry semantics. */
export const canTransitionIntegrationDeliveryState = ({
  from,
  to,
}: {
  readonly from: IntegrationDeliveryState;
  readonly to: IntegrationDeliveryState;
}): boolean => {
  if (from === to) {
    return false;
  }

  return (
    (from === "pending" && (to === "leased" || to === "canceled")) ||
    (from === "leased" &&
      (to === "pending" ||
        to === "succeeded" ||
        to === "exhausted" ||
        to === "canceled")) ||
    (from === "exhausted" && to === "pending")
  );
};
