/**
 * Shared send-attempt budgets.
 *
 * These live outside `queue.ts` because the provider-feedback ingestion also
 * decides whether a delivery may be retried: a soft or undetermined bounce
 * schedules another attempt, and it must stop at the same budget the queue
 * enforces after a temporary provider failure. Two copies of the number would
 * let an address bounce forever through one path while the other gives up.
 */

/** Provider submission attempts one delivery may consume. */
export const maximumDeliveryAttempts = 5;

/** Consecutive infrastructure failures before a delivery is failed terminally. */
export const maximumInfrastructureFailures = 10;
