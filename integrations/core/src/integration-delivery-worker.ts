import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import {
  classifyIntegrationProviderDeliveryFailure,
  type IntegrationDeliveryOutcome,
} from "./delivery-policy";
import { integrationDeliveryWorkerDefaults } from "./delivery-worker-defaults";
import type {
  IntegrationExternalResourceDraft,
  IntegrationProviderDeliveryInput,
} from "./integration-contracts";
import {
  recordIntegrationClaimedBacklog,
  recordIntegrationDeliveryOutcome,
} from "./integration-telemetry";
import type { IntegrationProviderRegistry } from "./provider-registry";

/** A claimed delivery carries a lease token; persistence must guard every acknowledgement by this token. */
export interface ClaimedIntegrationDelivery {
  readonly input: IntegrationProviderDeliveryInput;
  readonly leaseOwner: string;
}

/** Safe persistence failure surfaced by a worker poll without leaking payloads or credentials. */
export class IntegrationDeliveryWorkerPersistenceError extends Schema.TaggedError<IntegrationDeliveryWorkerPersistenceError>()(
  "IntegrationDeliveryWorkerPersistenceError",
  { operation: Schema.String }
) {}

/** PostgreSQL-backed worker repository boundary. Claim implementations use FOR UPDATE SKIP LOCKED in a short transaction. */
export interface IntegrationDeliveryWorkerRepository {
  /** Cancels a claimed request that lost its active lifecycle before I/O began. */
  readonly cancelClaimedDelivery: (input: {
    readonly claimed: ClaimedIntegrationDelivery;
  }) => Effect.Effect<void, IntegrationDeliveryWorkerPersistenceError>;
  /** Rechecks the active route, connection lifecycle, and unexpired owner lease before I/O. */
  readonly canExecuteClaimedDelivery: (input: {
    readonly claimed: ClaimedIntegrationDelivery;
  }) => Effect.Effect<boolean, IntegrationDeliveryWorkerPersistenceError>;
  readonly claimDueDeliveries: (input: {
    readonly limit: number;
    readonly leaseDurationMs: number;
    readonly leaseOwner: string;
  }) => Effect.Effect<
    readonly ClaimedIntegrationDelivery[],
    IntegrationDeliveryWorkerPersistenceError
  >;
  readonly persistDeliveryResult: (input: {
    readonly claimed: ClaimedIntegrationDelivery;
    readonly errorTag?: string;
    /** Provider-normalized resources persisted only with a successful delivery. */
    readonly externalResourceDrafts?: readonly IntegrationExternalResourceDraft[];
    readonly httpStatus?: number;
    readonly outcome: IntegrationDeliveryOutcome;
  }) => Effect.Effect<void, IntegrationDeliveryWorkerPersistenceError>;
  readonly recoverExpiredLeases: () => Effect.Effect<
    void,
    IntegrationDeliveryWorkerPersistenceError
  >;
}

/** Executes provider requests after claim commit, while result persistence remains guarded by the claim lease owner. */
export const runIntegrationDeliveryWorkerPoll = ({
  connectionConcurrency = integrationDeliveryWorkerDefaults.connectionConcurrency,
  globalConcurrency = integrationDeliveryWorkerDefaults.globalConcurrency,
  leaseOwner,
  registry,
  repository,
}: {
  readonly connectionConcurrency?: number;
  readonly globalConcurrency?: number;
  readonly leaseOwner: string;
  readonly registry: IntegrationProviderRegistry;
  readonly repository: IntegrationDeliveryWorkerRepository;
}) =>
  Effect.gen(function* () {
    const metricOutcome = (outcome: IntegrationDeliveryOutcome) => {
      if (outcome._tag === "Succeeded") {
        return "succeeded" as const;
      }
      if (outcome._tag === "Retry") {
        return "retry" as const;
      }
      return "exhausted" as const;
    };
    const semaphores = new Map<string, Semaphore.Semaphore>();
    const connectionSemaphore = (connectionId: string) => {
      const existing = semaphores.get(connectionId);
      if (existing !== undefined) {
        return existing;
      }
      const created = Semaphore.makeUnsafe(connectionConcurrency);
      semaphores.set(connectionId, created);
      return created;
    };
    yield* repository.recoverExpiredLeases();
    const claimed = yield* repository.claimDueDeliveries({
      leaseDurationMs: integrationDeliveryWorkerDefaults.leaseDurationMs,
      leaseOwner,
      limit: integrationDeliveryWorkerDefaults.batchSize,
    });
    yield* recordIntegrationClaimedBacklog(claimed.length);
    yield* Effect.forEach(
      claimed,
      (delivery) =>
        connectionSemaphore(delivery.input.connection.id)
          .withPermit(
            repository.canExecuteClaimedDelivery({ claimed: delivery }).pipe(
              Effect.flatMap((canExecute) =>
                Effect.gen(function* () {
                  if (!canExecute) {
                    yield* repository.cancelClaimedDelivery({
                      claimed: delivery,
                    });
                    return;
                  }
                  const startedAt = yield* DateTime.nowAsDate;
                  const handler = registry.getHandler({
                    capabilityKey: delivery.input.route.capabilityKey,
                    provider: delivery.input.route.provider,
                  });
                  const result: {
                    readonly errorTag?: string;
                    readonly externalResourceDrafts?: readonly IntegrationExternalResourceDraft[];
                    readonly httpStatus?: number;
                    readonly outcome: IntegrationDeliveryOutcome;
                  } =
                    handler === undefined
                      ? {
                          errorTag: "MissingIntegrationCapabilityHandler",
                          outcome: { _tag: "Terminal" } as const,
                        }
                      : yield* handler.deliver(delivery.input).pipe(
                          Effect.withSpan("IntegrationProvider.deliver", {
                            attributes: {
                              "integration.connection_id":
                                delivery.input.connection.id,
                              "integration.correlation_id":
                                delivery.input.event.correlationId,
                              "integration.delivery_id":
                                delivery.input.delivery.id,
                              "integration.event_id": delivery.input.event.id,
                              "integration.provider":
                                delivery.input.connection.provider,
                              "integration.route_id": delivery.input.route.id,
                            },
                          }),
                          Effect.match({
                            onFailure: (failure) => ({
                              errorTag: failure._tag,
                              ...(failure.httpStatus !== undefined && {
                                httpStatus: failure.httpStatus,
                              }),
                              outcome:
                                classifyIntegrationProviderDeliveryFailure(
                                  failure
                                ),
                            }),
                            onSuccess: (response) => ({
                              ...(response.httpStatus !== undefined && {
                                httpStatus: response.httpStatus,
                              }),
                              ...(response.externalResourceDrafts !== undefined && {
                                externalResourceDrafts: response.externalResourceDrafts,
                              }),
                              outcome: { _tag: "Succeeded" } as const,
                            }),
                          })
                        );
                  yield* repository.persistDeliveryResult({
                    claimed: delivery,
                    ...(result.errorTag !== undefined && {
                      errorTag: result.errorTag,
                    }),
                    ...(result.externalResourceDrafts !== undefined && {
                      externalResourceDrafts: result.externalResourceDrafts,
                    }),
                    ...(result.httpStatus !== undefined && {
                      httpStatus: result.httpStatus,
                    }),
                    outcome: result.outcome,
                  });
                  const finishedAt = yield* DateTime.nowAsDate;
                  yield* recordIntegrationDeliveryOutcome(
                    metricOutcome(result.outcome),
                    finishedAt.getTime() - startedAt.getTime(),
                    result.errorTag
                  );
                })
              )
            )
          )
          .pipe(
            Effect.catchTag(
              "IntegrationDeliveryWorkerPersistenceError",
              (error) =>
                Effect.logError(
                  "Integration delivery skipped after worker persistence failure",
                  {
                    connectionId: delivery.input.connection.id,
                    deliveryId: delivery.input.delivery.id,
                    errorTag: error._tag,
                    operation: error.operation,
                  }
                )
            )
          ),
      { concurrency: globalConcurrency, discard: true }
    );
  });

/** Runs the independently composable delivery poller until its enclosing scope closes. */
export const runIntegrationDeliveryWorker = (input: {
  readonly connectionConcurrency?: number;
  readonly globalConcurrency?: number;
  readonly leaseOwner: string;
  readonly registry: IntegrationProviderRegistry;
  readonly repository: IntegrationDeliveryWorkerRepository;
}) =>
  runIntegrationDeliveryWorkerPoll(input).pipe(
    Effect.tapError((error) =>
      Effect.logError("Integration delivery worker poll failed", {
        errorTag: error._tag,
        operation: error.operation,
      })
    ),
    Effect.catch(() => Effect.void),
    Effect.repeat(
      Schedule.spaced(integrationDeliveryWorkerDefaults.pollIntervalMs)
    )
  );
