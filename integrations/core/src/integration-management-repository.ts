import { currentDb, type Database, schema } from "@feeblo/db";
import type { TIntegrationDeliveryState } from "@feeblo/db/validation-schema/integration";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

/**
 * Terminal delivery states (per the schema's terminal timestamp check). Pending
 * and leased deliveries are still queued or in flight and must never be purged;
 * exhausted is terminal too — its manual-retry window is bounded by retention
 * anyway (retries span at most ~7 days against a 30-day window, and retrying a
 * delivery past retention is impossible since its event row is already purged).
 */
const purgeableDeliveryStates = [
  "succeeded",
  "exhausted",
  "canceled",
] as const satisfies readonly TIntegrationDeliveryState[];

/** Management repository for idempotent retention cleanup of expired
 * integration history and archived connection metadata. */
export interface IntegrationManagementRepository {
  readonly cleanupRetention: (input: {
    readonly before: Date;
  }) => Effect.Effect<void, SqlError | EffectDrizzleQueryError>;
}

export const makeIntegrationManagementRepository: Effect.Effect<
  IntegrationManagementRepository,
  never,
  Database.Database
> = Effect.gen(function* () {
  const db = yield* currentDb;
  const cleanupRetention = Effect.fn(
    "IntegrationManagementRepository.cleanupRetention"
  )(function* ({ before }: { readonly before: Date }) {
    yield* db.transaction(() =>
      Effect.gen(function* () {
        yield* db
          .delete(schema.integrationDeliveryAttemptTable)
          .where(
            lte(
              schema.integrationDeliveryAttemptTable.retentionExpiresAt,
              before
            )
          );
        yield* db
          .delete(schema.integrationDeliveryTable)
          .where(
            and(
              inArray(
                schema.integrationDeliveryTable.state,
                purgeableDeliveryStates
              ),
              lte(schema.integrationDeliveryTable.retentionExpiresAt, before)
            )
          );
        yield* db
          .delete(schema.integrationEventTable)
          .where(lte(schema.integrationEventTable.retentionExpiresAt, before));
        const archived = yield* db
          .select({ id: schema.integrationConnectionTable.id })
          .from(schema.integrationConnectionTable)
          .where(
            and(
              eq(schema.integrationConnectionTable.lifecycle, "archived"),
              lte(schema.integrationConnectionTable.retentionExpiresAt, before)
            )
          );
        const connectionIds = archived.map(({ id }) => id);
        if (connectionIds.length === 0) {
          return;
        }
        yield* db
          .delete(schema.integrationRouteTable)
          .where(
            inArray(schema.integrationRouteTable.connectionId, connectionIds)
          );
        yield* db
          .delete(schema.integrationConnectionTable)
          .where(inArray(schema.integrationConnectionTable.id, connectionIds));
      })
    );
  });
  return {
    cleanupRetention,
  };
});
