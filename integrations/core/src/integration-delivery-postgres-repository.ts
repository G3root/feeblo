import { currentDb, schema } from "@feeblo/db";
import type { TIntegrationCapabilityKey } from "@feeblo/db/validation-schema/integration";
import {
  asLegid,
  IntegrationConnectionId,
  IntegrationDeliveryAttemptId,
  IntegrationDeliveryId,
  IntegrationEventId,
  IntegrationRouteId,
  WorkspaceId,
} from "@feeblo/id";
import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import { decideIntegrationDeliveryRetry } from "./delivery-policy";
import { integrationDeliveryWorkerDefaults } from "./delivery-worker-defaults";
import {
  IntegrationConnection,
  IntegrationDelivery,
  IntegrationEventEnvelopeV1,
  IntegrationRoute,
} from "./integration-contracts";
import {
  type ClaimedIntegrationDelivery,
  IntegrationDeliveryWorkerPersistenceError,
  type IntegrationDeliveryWorkerRepository,
} from "./integration-delivery-worker";
import {
  recordIntegrationAutomaticPause,
  recordIntegrationDeliveryBacklog,
  recordIntegrationLeaseRecoveries,
  recordIntegrationRecoveredLeaseAge,
} from "./integration-telemetry";

const ClaimedProviderInput = Schema.Struct({
  connection: IntegrationConnection,
  delivery: IntegrationDelivery,
  event: IntegrationEventEnvelopeV1,
  route: IntegrationRoute,
});

const persistenceError = (operation: string) =>
  new IntegrationDeliveryWorkerPersistenceError({ operation });

const attemptRetryDecision = (
  decision: ReturnType<typeof decideIntegrationDeliveryRetry>
) => {
  if (decision._tag === "Succeeded") {
    return "pending" as const;
  }
  if (decision._tag === "Retry") {
    return "retry" as const;
  }
  return "exhausted" as const;
};

const mapPersistenceError = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, IntegrationDeliveryWorkerPersistenceError, R> =>
  effect.pipe(
    Effect.mapError((error) =>
      error instanceof IntegrationDeliveryWorkerPersistenceError
        ? error
        : persistenceError(operation)
    )
  );

/**
 * PostgreSQL persistence boundary for lease ownership; it never performs
 * provider I/O. Deliveries are claimed only for the supplied outbound
 * capability keys, which the startup-validated provider registry owns.
 */
export const makeIntegrationDeliveryWorkerRepository = (
  claimableCapabilityKeys: readonly string[]
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;

    const loadClaimedDelivery = (deliveryId: string, leaseOwner: string) =>
      Effect.gen(function* () {
        const [row] = yield* db
          .select({
            connection: schema.integrationConnectionTable,
            delivery: schema.integrationDeliveryTable,
            event: schema.integrationEventTable,
            route: schema.integrationRouteTable,
          })
          .from(schema.integrationDeliveryTable)
          .innerJoin(
            schema.integrationConnectionTable,
            eq(
              schema.integrationDeliveryTable.connectionId,
              schema.integrationConnectionTable.id
            )
          )
          .innerJoin(
            schema.integrationRouteTable,
            eq(
              schema.integrationDeliveryTable.routeId,
              schema.integrationRouteTable.id
            )
          )
          .innerJoin(
            schema.integrationEventTable,
            eq(
              schema.integrationDeliveryTable.eventId,
              schema.integrationEventTable.id
            )
          )
          .where(
            and(
              eq(schema.integrationDeliveryTable.id, deliveryId),
              eq(schema.integrationDeliveryTable.state, "leased"),
              eq(schema.integrationDeliveryTable.leaseOwner, leaseOwner)
            )
          )
          .limit(1);
        if (row === undefined) {
          return yield* persistenceError("load_claimed_delivery");
        }
        const input = yield* Schema.decodeUnknownEffect(ClaimedProviderInput)({
          connection: {
            credentialGeneration: row.connection.credentialGeneration,
            id: asLegid(IntegrationConnectionId)(row.connection.id),
            lifecycleStatus: row.connection.lifecycle,
            name: row.connection.name,
            organizationId: asLegid(WorkspaceId)(row.connection.organizationId),
            provider: row.connection.provider,
            safeMetadata: row.connection.safeDisplayMetadata ?? {},
          },
          delivery: {
            actionKey: row.delivery.actionKey,
            attemptCount: row.delivery.attemptCount,
            eventId: asLegid(IntegrationEventId)(row.delivery.eventId),
            id: asLegid(IntegrationDeliveryId)(row.delivery.id),
            leaseExpiresAt:
              row.delivery.leaseExpiresAt === null
                ? null
                : row.delivery.leaseExpiresAt.toISOString(),
            leaseOwner: row.delivery.leaseOwner,
            nextAttemptAt: row.delivery.nextAttemptAt.toISOString(),
            orderingKey: row.delivery.orderingKey,
            routeId: asLegid(IntegrationRouteId)(row.delivery.routeId),
            state: row.delivery.state,
          },
          event: {
            causalHopCount: row.event.causalHopCount,
            ...(row.event.causationId === null
              ? {}
              : { causationId: row.event.causationId }),
            correlationId: row.event.correlationId,
            data: row.event.payload,
            id: asLegid(IntegrationEventId)(row.event.id),
            occurredAt: row.event.occurredAt.toISOString(),
            organizationId: asLegid(WorkspaceId)(row.event.organizationId),
            origin: row.event.origin,
            type: row.event.type,
            version: row.event.version,
          },
          route: {
            capabilityKey: row.route.capabilityKey,
            configVersion: row.route.configVersion,
            connectionId: asLegid(IntegrationConnectionId)(
              row.route.connectionId
            ),
            enabled: row.route.enabled,
            eventTypes: row.route.eventTypes,
            id: asLegid(IntegrationRouteId)(row.route.id),
            provider: row.connection.provider,
            safeMetadata: row.route.safeDisplayMetadata ?? {},
          },
        }).pipe(
          Effect.mapError(() => persistenceError("decode_claimed_delivery"))
        );
        return { input, leaseOwner } satisfies ClaimedIntegrationDelivery;
      });

    const claimDueDeliveries: IntegrationDeliveryWorkerRepository["claimDueDeliveries"] =
      ({ leaseDurationMs, leaseOwner, limit }) =>
        mapPersistenceError(
          "claim_due_deliveries",
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            const [backlog] = yield* db
              .select({ count: sql<number>`count(*)` })
              .from(schema.integrationDeliveryTable)
              .where(
                and(
                  eq(schema.integrationDeliveryTable.state, "pending"),
                  lte(schema.integrationDeliveryTable.nextAttemptAt, now)
                )
              );
            yield* recordIntegrationDeliveryBacklog(
              Number(backlog?.count ?? 0)
            );
            const claimedIds = yield* db.transaction(() =>
              Effect.gen(function* () {
                const due = yield* db
                  .select({ id: schema.integrationDeliveryTable.id })
                  .from(schema.integrationDeliveryTable)
                  .innerJoin(
                    schema.integrationConnectionTable,
                    eq(
                      schema.integrationDeliveryTable.connectionId,
                      schema.integrationConnectionTable.id
                    )
                  )
                  .innerJoin(
                    schema.integrationRouteTable,
                    eq(
                      schema.integrationDeliveryTable.routeId,
                      schema.integrationRouteTable.id
                    )
                  )
                  .where(
                    and(
                      eq(schema.integrationDeliveryTable.state, "pending"),
                      lte(schema.integrationDeliveryTable.nextAttemptAt, now),
                      eq(schema.integrationConnectionTable.lifecycle, "active"),
                      eq(schema.integrationRouteTable.enabled, true),
                      inArray(
                        schema.integrationRouteTable.capabilityKey,
                        // SAFETY: the claimable keys come from the
                        // startup-validated provider registry, which constrains
                        // them to the canonical capability vocabulary; unknown
                        // keys simply never match a stored route capability.
                        claimableCapabilityKeys as readonly TIntegrationCapabilityKey[]
                      )
                    )
                  )
                  .orderBy(schema.integrationDeliveryTable.nextAttemptAt)
                  .limit(limit)
                  .for("update", {
                    skipLocked: true,
                    of: schema.integrationDeliveryTable,
                  });
                const leaseExpiresAt = new Date(
                  now.getTime() + leaseDurationMs
                );
                return yield* Effect.forEach(due, ({ id }) =>
                  Effect.gen(function* () {
                    const [delivery] = yield* db
                      .update(schema.integrationDeliveryTable)
                      .set({
                        attemptCount: sql`${schema.integrationDeliveryTable.attemptCount} + 1`,
                        leaseExpiresAt,
                        leaseOwner,
                        state: "leased",
                        updatedAt: now,
                      })
                      .where(
                        and(
                          eq(schema.integrationDeliveryTable.id, id),
                          eq(schema.integrationDeliveryTable.state, "pending")
                        )
                      )
                      .returning({
                        attemptCount:
                          schema.integrationDeliveryTable.attemptCount,
                        id: schema.integrationDeliveryTable.id,
                      });
                    if (delivery === undefined) {
                      return undefined;
                    }
                    const attemptId =
                      yield* IntegrationDeliveryAttemptId.generate;
                    yield* db
                      .insert(schema.integrationDeliveryAttemptTable)
                      .values({
                        attemptNumber: delivery.attemptCount,
                        deliveryId: delivery.id,
                        id: attemptId,
                        retentionExpiresAt: new Date(
                          now.getTime() +
                            integrationDeliveryWorkerDefaults.retentionMs
                        ),
                        startedAt: now,
                      });
                    return delivery.id;
                  })
                ).pipe(
                  Effect.map((ids) =>
                    ids.filter((id): id is string => id !== undefined)
                  )
                );
              })
            );
            return yield* Effect.forEach(claimedIds, (id) =>
              loadClaimedDelivery(id, leaseOwner)
            );
          })
        );

    const canExecuteClaimedDelivery: IntegrationDeliveryWorkerRepository["canExecuteClaimedDelivery"] =
      ({ claimed }) =>
        mapPersistenceError(
          "can_execute_claimed_delivery",
          db.transaction(() =>
            Effect.gen(function* () {
              const now = yield* DateTime.nowAsDate;
              const [row] = yield* db
                .select({ id: schema.integrationDeliveryTable.id })
                .from(schema.integrationDeliveryTable)
                .innerJoin(
                  schema.integrationConnectionTable,
                  eq(
                    schema.integrationDeliveryTable.connectionId,
                    schema.integrationConnectionTable.id
                  )
                )
                .innerJoin(
                  schema.integrationRouteTable,
                  eq(
                    schema.integrationDeliveryTable.routeId,
                    schema.integrationRouteTable.id
                  )
                )
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.id,
                      claimed.input.delivery.id
                    ),
                    eq(schema.integrationDeliveryTable.state, "leased"),
                    eq(
                      schema.integrationDeliveryTable.leaseOwner,
                      claimed.leaseOwner
                    ),
                    gt(schema.integrationDeliveryTable.leaseExpiresAt, now),
                    eq(schema.integrationConnectionTable.lifecycle, "active"),
                    eq(schema.integrationRouteTable.enabled, true)
                  )
                )
                // Lifecycle operations lock the same connection row. Whichever
                // transaction commits first defines whether this request started.
                .for("update", { of: schema.integrationConnectionTable })
                .limit(1);
              return row !== undefined;
            })
          )
        );

    const persistDeliveryResult: IntegrationDeliveryWorkerRepository["persistDeliveryResult"] =
      ({ claimed, errorTag, httpStatus, outcome }) =>
        mapPersistenceError(
          "persist_delivery_result",
          db.transaction(() =>
            Effect.gen(function* () {
              const now = yield* DateTime.nowAsDate;
              const [leased] = yield* db
                .select({
                  attemptCount: schema.integrationDeliveryTable.attemptCount,
                  connectionId: schema.integrationDeliveryTable.connectionId,
                })
                .from(schema.integrationDeliveryTable)
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.id,
                      claimed.input.delivery.id
                    ),
                    eq(schema.integrationDeliveryTable.state, "leased"),
                    eq(
                      schema.integrationDeliveryTable.leaseOwner,
                      claimed.leaseOwner
                    )
                  )
                )
                .for("update")
                .limit(1);
              if (leased === undefined) {
                return;
              }
              const [attempt] = yield* db
                .select({
                  id: schema.integrationDeliveryAttemptTable.id,
                  startedAt: schema.integrationDeliveryAttemptTable.startedAt,
                })
                .from(schema.integrationDeliveryAttemptTable)
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryAttemptTable.deliveryId,
                      claimed.input.delivery.id
                    ),
                    eq(
                      schema.integrationDeliveryAttemptTable.attemptNumber,
                      leased.attemptCount
                    ),
                    isNull(schema.integrationDeliveryAttemptTable.finishedAt)
                  )
                )
                .limit(1);
              const jitterSource = yield* Random.next;
              const decision = decideIntegrationDeliveryRetry({
                attemptCount: leased.attemptCount,
                jitterRatio: jitterSource * 0.4 - 0.2,
                outcome,
              });
              const retryDecision = attemptRetryDecision(decision);
              if (attempt !== undefined) {
                yield* db
                  .update(schema.integrationDeliveryAttemptTable)
                  .set({
                    durationMs: Math.max(
                      0,
                      now.getTime() - attempt.startedAt.getTime()
                    ),
                    ...(errorTag === undefined ? {} : { errorTag }),
                    finishedAt: now,
                    ...(httpStatus === undefined ? {} : { httpStatus }),
                    retryDecision,
                  })
                  .where(
                    eq(schema.integrationDeliveryAttemptTable.id, attempt.id)
                  );
              }
              if (decision._tag === "Succeeded") {
                yield* db
                  .update(schema.integrationDeliveryTable)
                  .set({
                    lastError: null,
                    leaseExpiresAt: null,
                    leaseOwner: null,
                    state: "succeeded",
                    succeededAt: now,
                    updatedAt: now,
                  })
                  .where(
                    and(
                      eq(
                        schema.integrationDeliveryTable.id,
                        claimed.input.delivery.id
                      ),
                      eq(schema.integrationDeliveryTable.state, "leased"),
                      eq(
                        schema.integrationDeliveryTable.leaseOwner,
                        claimed.leaseOwner
                      )
                    )
                  );
                yield* db
                  .update(schema.integrationConnectionTable)
                  .set({
                    consecutiveExhaustedDeliveries: 0,
                    lastSucceededAt: now,
                    updatedAt: now,
                  })
                  .where(
                    eq(
                      schema.integrationConnectionTable.id,
                      leased.connectionId
                    )
                  );
                return;
              }
              if (decision._tag === "Retry") {
                yield* db
                  .update(schema.integrationDeliveryTable)
                  .set({
                    lastError: errorTag === undefined ? null : { errorTag },
                    leaseExpiresAt: null,
                    leaseOwner: null,
                    nextAttemptAt: new Date(now.getTime() + decision.delayMs),
                    state: "pending",
                    updatedAt: now,
                  })
                  .where(
                    and(
                      eq(
                        schema.integrationDeliveryTable.id,
                        claimed.input.delivery.id
                      ),
                      eq(schema.integrationDeliveryTable.state, "leased"),
                      eq(
                        schema.integrationDeliveryTable.leaseOwner,
                        claimed.leaseOwner
                      )
                    )
                  );
                yield* db
                  .update(schema.integrationConnectionTable)
                  .set({
                    lastFailedAt: now,
                    updatedAt: now,
                  })
                  .where(
                    eq(
                      schema.integrationConnectionTable.id,
                      leased.connectionId
                    )
                  );
                return;
              }
              yield* db
                .update(schema.integrationDeliveryTable)
                .set({
                  exhaustedAt: now,
                  lastError: errorTag === undefined ? null : { errorTag },
                  leaseExpiresAt: null,
                  leaseOwner: null,
                  state: "exhausted",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.id,
                      claimed.input.delivery.id
                    ),
                    eq(schema.integrationDeliveryTable.state, "leased"),
                    eq(
                      schema.integrationDeliveryTable.leaseOwner,
                      claimed.leaseOwner
                    )
                  )
                );
              const [connection] = yield* db
                .update(schema.integrationConnectionTable)
                .set({
                  consecutiveExhaustedDeliveries: sql`${schema.integrationConnectionTable.consecutiveExhaustedDeliveries} + 1`,
                  lastFailedAt: now,
                  updatedAt: now,
                })
                .where(
                  eq(schema.integrationConnectionTable.id, leased.connectionId)
                )
                .returning({
                  exhaustedCount:
                    schema.integrationConnectionTable
                      .consecutiveExhaustedDeliveries,
                });
              if ((connection?.exhaustedCount ?? 0) < 10) {
                return;
              }
              yield* db
                .update(schema.integrationConnectionTable)
                .set({ lifecycle: "paused", updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationConnectionTable.id,
                      leased.connectionId
                    ),
                    eq(schema.integrationConnectionTable.lifecycle, "active")
                  )
                );
              yield* db
                .update(schema.integrationRouteTable)
                .set({ enabled: false, updatedAt: now })
                .where(
                  eq(
                    schema.integrationRouteTable.connectionId,
                    leased.connectionId
                  )
                );
              yield* db
                .update(schema.integrationDeliveryTable)
                .set({
                  canceledAt: now,
                  state: "canceled",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.connectionId,
                      leased.connectionId
                    ),
                    eq(schema.integrationDeliveryTable.state, "pending")
                  )
                );
              yield* recordIntegrationAutomaticPause();
            })
          )
        );

    const cancelClaimedDelivery: IntegrationDeliveryWorkerRepository["cancelClaimedDelivery"] =
      ({ claimed }) =>
        mapPersistenceError(
          "cancel_claimed_delivery",
          db.transaction(() =>
            Effect.gen(function* () {
              const now = yield* DateTime.nowAsDate;
              const [row] = yield* db
                .select({
                  connectionLifecycle:
                    schema.integrationConnectionTable.lifecycle,
                  routeEnabled: schema.integrationRouteTable.enabled,
                })
                .from(schema.integrationDeliveryTable)
                .innerJoin(
                  schema.integrationConnectionTable,
                  eq(
                    schema.integrationDeliveryTable.connectionId,
                    schema.integrationConnectionTable.id
                  )
                )
                .innerJoin(
                  schema.integrationRouteTable,
                  eq(
                    schema.integrationDeliveryTable.routeId,
                    schema.integrationRouteTable.id
                  )
                )
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.id,
                      claimed.input.delivery.id
                    ),
                    eq(schema.integrationDeliveryTable.state, "leased"),
                    eq(
                      schema.integrationDeliveryTable.leaseOwner,
                      claimed.leaseOwner
                    )
                  )
                )
                .for("update", { of: schema.integrationDeliveryTable })
                .limit(1);
              if (
                row === undefined ||
                (row.connectionLifecycle === "active" && row.routeEnabled)
              ) {
                return;
              }
              yield* db
                .update(schema.integrationDeliveryAttemptTable)
                .set({
                  durationMs: 0,
                  errorTag: "lifecycle_canceled",
                  finishedAt: now,
                  retryDecision: "canceled",
                })
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryAttemptTable.deliveryId,
                      claimed.input.delivery.id
                    ),
                    isNull(schema.integrationDeliveryAttemptTable.finishedAt)
                  )
                );
              yield* db
                .update(schema.integrationDeliveryTable)
                .set({
                  canceledAt: now,
                  leaseExpiresAt: null,
                  leaseOwner: null,
                  state: "canceled",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.id,
                      claimed.input.delivery.id
                    ),
                    eq(schema.integrationDeliveryTable.state, "leased"),
                    eq(
                      schema.integrationDeliveryTable.leaseOwner,
                      claimed.leaseOwner
                    )
                  )
                );
            })
          )
        );

    const recoverExpiredLeases: IntegrationDeliveryWorkerRepository["recoverExpiredLeases"] =
      () =>
        mapPersistenceError(
          "recover_expired_leases",
          db.transaction(() =>
            Effect.gen(function* () {
              const now = yield* DateTime.nowAsDate;
              const expired = yield* db
                .select({
                  connectionLifecycle:
                    schema.integrationConnectionTable.lifecycle,
                  id: schema.integrationDeliveryTable.id,
                  leaseExpiresAt:
                    schema.integrationDeliveryTable.leaseExpiresAt,
                  routeEnabled: schema.integrationRouteTable.enabled,
                })
                .from(schema.integrationDeliveryTable)
                .innerJoin(
                  schema.integrationConnectionTable,
                  eq(
                    schema.integrationDeliveryTable.connectionId,
                    schema.integrationConnectionTable.id
                  )
                )
                .innerJoin(
                  schema.integrationRouteTable,
                  eq(
                    schema.integrationDeliveryTable.routeId,
                    schema.integrationRouteTable.id
                  )
                )
                .where(
                  and(
                    eq(schema.integrationDeliveryTable.state, "leased"),
                    lte(schema.integrationDeliveryTable.leaseExpiresAt, now)
                  )
                )
                .for("update", {
                  skipLocked: true,
                  of: schema.integrationDeliveryTable,
                });
              if (expired.length === 0) {
                return;
              }
              const recoverableIds = expired
                .filter(
                  ({ connectionLifecycle, routeEnabled }) =>
                    connectionLifecycle === "active" && routeEnabled
                )
                .map(({ id }) => id);
              const canceledIds = expired
                .filter(
                  ({ connectionLifecycle, routeEnabled }) =>
                    connectionLifecycle !== "active" || !routeEnabled
                )
                .map(({ id }) => id);
              const oldestLeaseExpiry = expired.reduce(
                (oldest, delivery) =>
                  delivery.leaseExpiresAt !== null &&
                  delivery.leaseExpiresAt < oldest
                    ? delivery.leaseExpiresAt
                    : oldest,
                now
              );
              yield* recordIntegrationRecoveredLeaseAge(
                now.getTime() -
                  oldestLeaseExpiry.getTime() +
                  integrationDeliveryWorkerDefaults.leaseDurationMs
              );
              if (recoverableIds.length > 0) {
                yield* db
                  .update(schema.integrationDeliveryAttemptTable)
                  .set({
                    durationMs: 0,
                    errorTag: "lease_expired",
                    finishedAt: now,
                    retryDecision: "retry",
                  })
                  .where(
                    and(
                      inArray(
                        schema.integrationDeliveryAttemptTable.deliveryId,
                        recoverableIds
                      ),
                      isNull(schema.integrationDeliveryAttemptTable.finishedAt)
                    )
                  );
                yield* db
                  .update(schema.integrationDeliveryTable)
                  .set({
                    leaseExpiresAt: null,
                    leaseOwner: null,
                    nextAttemptAt: now,
                    state: "pending",
                    updatedAt: now,
                  })
                  .where(
                    and(
                      inArray(
                        schema.integrationDeliveryTable.id,
                        recoverableIds
                      ),
                      eq(schema.integrationDeliveryTable.state, "leased")
                    )
                  );
              }
              if (canceledIds.length > 0) {
                yield* db
                  .update(schema.integrationDeliveryAttemptTable)
                  .set({
                    durationMs: 0,
                    errorTag: "lifecycle_canceled",
                    finishedAt: now,
                    retryDecision: "canceled",
                  })
                  .where(
                    and(
                      inArray(
                        schema.integrationDeliveryAttemptTable.deliveryId,
                        canceledIds
                      ),
                      isNull(schema.integrationDeliveryAttemptTable.finishedAt)
                    )
                  );
                yield* db
                  .update(schema.integrationDeliveryTable)
                  .set({
                    canceledAt: now,
                    leaseExpiresAt: null,
                    leaseOwner: null,
                    state: "canceled",
                    updatedAt: now,
                  })
                  .where(
                    and(
                      inArray(schema.integrationDeliveryTable.id, canceledIds),
                      eq(schema.integrationDeliveryTable.state, "leased")
                    )
                  );
              }
              yield* recordIntegrationLeaseRecoveries(expired.length);
            })
          )
        );

    return {
      canExecuteClaimedDelivery,
      cancelClaimedDelivery,
      claimDueDeliveries,
      persistDeliveryResult,
      recoverExpiredLeases,
    } satisfies IntegrationDeliveryWorkerRepository;
  });
