import { currentDb, schema } from "@feeblo/db";
import { and, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

export interface StoredObject {
  readonly bucket: string;
  readonly key: string;
}

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
        objects.map(({ bucket, key }) => ({
          id: crypto.randomUUID(),
          bucket,
          key,
          error,
        }))
      )
      .onConflictDoNothing({
        target: [
          schema.assetDeletionTable.bucket,
          schema.assetDeletionTable.key,
        ],
      });
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
