import { currentDb, schema } from "@feeblo/db";
import { and, eq, inArray, lte } from "drizzle-orm";
import * as Effect from "effect/Effect";

/** Idempotent retention cleanup for safe integration history and archived metadata. */
export const makeIntegrationManagementRepository = Effect.gen(function* () {
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
            lte(schema.integrationDeliveryTable.retentionExpiresAt, before)
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
