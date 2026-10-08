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
  readonly polarServer: string;
};

/**
 * Revokes one queued subscription and records the outcome in the queue.
 *
 * A Polar failure is terminal for this attempt, not for the queue: the row
 * stays pending and the next pass tries again. The exception is an
 * already-terminated subscription — Polar's 403 `AlreadyCanceledSubscription`
 * or typed 404 `ResourceNotFound` — where the wanted postcondition already
 * holds, so the row is closed instead of retried forever. That exception only
 * applies when the row's originating target is the configured target: a 404
 * from another target says nothing about the subscription, so the row is left
 * pending for reconciliation instead of being sent there or closed. (The sweep
 * query already excludes other-target rows; this check remains as defense for
 * a direct caller.) A failure to record the outcome is a real error and stays
 * in the error channel, because losing it would leave the queue claiming work
 * that already happened.
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

  // The row belongs to the target it was created on. Sending it to a different
  // target cannot revoke it and could only answer about that target's own
  // ids, so leave it for an operator to restore the target configuration or
  // reconcile it manually.
  if (revocation.polarServer !== polarService.target) {
    yield* Effect.logWarning(
      "Leaving a queued Polar revocation pending because its originating target is not the configured target",
      {
        externalSubscriptionId: revocation.externalSubscriptionId,
        organizationId: revocation.organizationId,
        originatingTarget: revocation.polarServer,
        configuredTarget: polarService.target,
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
        error.alreadyRevoked === true
          ? repository.markSubscriptionRevocationSucceeded({
              externalSubscriptionId: revocation.externalSubscriptionId,
            })
          : repository.markSubscriptionRevocationFailed({
              externalSubscriptionId: revocation.externalSubscriptionId,
              message: error.message ?? "Failed to revoke Polar subscription",
            })
      )
    );
});

/**
 * One pass over every revocation whose workspace is already gone and whose
 * originating target is the configured one. Called right after a deletion
 * commits so the common case does not wait for the loop, and by the loop
 * itself for everything that failed. Billing that is not configured leaves
 * every row pending: without a client nothing can be revoked, so the pass
 * says so once instead of walking the queue.
 */
export const revokePendingSubscriptionRevocations = Effect.fn(
  "SubscriptionRevocation.revokePass"
)(function* ({
  organizationId,
  limit = REVOCATION_BATCH_SIZE,
}: {
  organizationId?: string;
  limit?: number;
} = {}) {
  const polarService = yield* PolarService;
  const repository = yield* BillingRepository;

  if (!polarService.client) {
    yield* Effect.logWarning(
      "Skipping the Polar subscription revocation pass because billing is not configured"
    );
    return;
  }

  const revocations = yield* repository.findPendingSubscriptionRevocations({
    ...(organizationId !== undefined && { organizationId }),
    polarServer: polarService.target,
    limit,
  });

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
 * transient here, and the next pass is the retry. Typed failures and defects
 * are caught separately so interruption still propagates and the loop dies
 * with its scope instead of spinning.
 */
export const subscriptionRevocationMaintenance =
  revokePendingSubscriptionRevocations({}).pipe(
    Effect.tap(() =>
      Effect.logDebug("Ran the Polar subscription revocation pass")
    ),
    Effect.catch((error) =>
      Effect.logError("Polar subscription revocation pass failed", error)
    ),
    Effect.catchDefect((defect) =>
      Effect.logError("Polar subscription revocation pass defected", defect)
    ),
    Effect.repeat(Schedule.spaced(REVOCATION_RETRY_INTERVAL))
  );
