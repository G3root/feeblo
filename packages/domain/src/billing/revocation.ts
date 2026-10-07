import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { BillingRepository } from "./repository";
import { PolarService } from "./service";

/** How many queued revocations one pass attempts. */
const REVOCATION_BATCH_SIZE = 50;

/** How often the retry loop sweeps the queue. */
const REVOCATION_RETRY_INTERVAL = Duration.minutes(5);

type QueuedRevocation = {
  readonly externalSubscriptionId: string;
  readonly organizationId: string;
};

/**
 * Revokes one queued subscription and records the outcome in the queue.
 *
 * A Polar failure is terminal for this attempt, not for the queue: the row
 * stays pending and the next pass tries again. A failure to record the
 * outcome is a real error and stays in the error channel, because losing it
 * would leave the queue claiming work that already happened.
 */
export const revokeQueuedSubscription = Effect.fn(
  "SubscriptionRevocation.revokeQueued"
)(function* (revocation: QueuedRevocation) {
  const polarService = yield* PolarService;
  const repository = yield* BillingRepository;

  // A queued row is evidence that Polar was configured when the workspace
  // was deleted. Without a client the revocation cannot run, so the row stays
  // pending instead of being marked done against a subscription that may
  // still be billing.
  if (!polarService.client) {
    yield* Effect.logWarning(
      "Leaving a queued Polar revocation pending because billing is not configured",
      {
        externalSubscriptionId: revocation.externalSubscriptionId,
        organizationId: revocation.organizationId,
      }
    );
    return;
  }

  yield* polarService
    .revokeSubscription({ id: revocation.externalSubscriptionId })
    .pipe(
      Effect.flatMap(() =>
        repository.markSubscriptionRevocationSucceeded({
          externalSubscriptionId: revocation.externalSubscriptionId,
        })
      ),
      Effect.catchTag("FailedToRevokeSubscriptionError", (error) =>
        repository.markSubscriptionRevocationFailed({
          externalSubscriptionId: revocation.externalSubscriptionId,
          message: error.message ?? "Failed to revoke Polar subscription",
        })
      )
    );
});

/**
 * One pass over every revocation whose workspace is already gone. Called
 * right after a deletion commits so the common case does not wait for the
 * loop, and by the loop itself for everything that failed.
 */
export const revokePendingSubscriptionRevocations = ({
  organizationId,
  limit = REVOCATION_BATCH_SIZE,
}: {
  organizationId?: string;
  limit?: number;
}) =>
  Effect.gen(function* () {
    const repository = yield* BillingRepository;
    const revocations = yield* repository.findPendingSubscriptionRevocations(
      organizationId === undefined ? { limit } : { organizationId, limit }
    );

    yield* Effect.forEach(revocations, revokeQueuedSubscription, {
      concurrency: 1,
      discard: true,
    });
  });

/**
 * Durable half of deletion: keeps retrying queued revocations until Polar
 * acknowledges them, so a Polar outage at delete time cannot leave a live
 * subscription billing a workspace Feeblo no longer knows about.
 *
 * Never fails — an unreachable database and an unreachable Polar are both
 * transient here, and the next pass is the retry.
 */
export const subscriptionRevocationMaintenance =
  revokePendingSubscriptionRevocations({}).pipe(
    Effect.tap(() =>
      Effect.logDebug("Ran the Polar subscription revocation pass")
    ),
    Effect.catchCause((cause) =>
      Effect.logError("Polar subscription revocation pass failed", cause)
    ),
    Effect.repeat(Schedule.spaced(REVOCATION_RETRY_INTERVAL))
  );
