import { currentDb, schema } from "@feeblo/db";
import { AssetId } from "@feeblo/id";
import { and, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

export interface StoredObject {
  readonly bucket: string;
  readonly key: string;
}

export const MAX_ASSET_DELETION_ROUNDS = 10;

export const queueObjectDeletions = (
  objects: readonly StoredObject[],
  error = "Queued for deletion"
) =>
  Effect.gen(function* () {
    if (objects.length === 0) {
      return;
    }
    const db = yield* currentDb;
    yield* db
      .insert(schema.assetDeletionTable)
      .values(
        yield* Effect.forEach(objects, ({ bucket, key }) =>
          Effect.gen(function* () {
            const id = yield* AssetId.generate;
            return { id, bucket, key, error };
          })
        )
      )
      .onConflictDoNothing({
        target: [
          schema.assetDeletionTable.bucket,
          schema.assetDeletionTable.key,
        ],
      });
  });

export const getObjectDeletionAttempts = ({ bucket, key }: StoredObject) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const [deletion] = yield* db
      .select({ attempts: schema.assetDeletionTable.attempts })
      .from(schema.assetDeletionTable)
      .where(
        and(
          eq(schema.assetDeletionTable.bucket, bucket),
          eq(schema.assetDeletionTable.key, key)
        )
      )
      .limit(1);

    return deletion?.attempts;
  });

export const clearObjectDeletion = ({ bucket, key }: StoredObject) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db
      .delete(schema.assetDeletionTable)
      .where(
        and(
          eq(schema.assetDeletionTable.bucket, bucket),
          eq(schema.assetDeletionTable.key, key)
        )
      );
  });

export const recordObjectDeletionFailure = (
  { bucket, key }: StoredObject,
  error: string
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db
      .update(schema.assetDeletionTable)
      .set({
        error,
        attempts: sql`${schema.assetDeletionTable.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.assetDeletionTable.bucket, bucket),
          eq(schema.assetDeletionTable.key, key)
        )
      );
  });
