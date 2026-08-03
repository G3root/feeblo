import { currentDb, schema, transaction } from "@feeblo/db";
import { lt } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import {
  MAX_ASSET_DELETION_ROUNDS,
  queueObjectDeletions,
  type StoredObject,
} from "./deletion-repository";
import { AssetRepository } from "./repository";
import { AssetDeletionWorkflow } from "./workflow";

export interface StoredAsset extends StoredObject {
  readonly id: string;
}

const DELETE_CONCURRENCY = 10;
const SWEEP_INTERVAL = "1 minute";

export const stageAssetDeletions = (assets: readonly StoredAsset[]) =>
  Effect.gen(function* () {
    const repository = yield* AssetRepository;
    yield* repository.deleteByIds(assets.map(({ id }) => id));
    yield* queueObjectDeletions(assets);
  });

export const sweepAssetDeletions = Effect.gen(function* () {
  const db = yield* currentDb;
  const pending = yield* db
    .select({
      bucket: schema.assetDeletionTable.bucket,
      key: schema.assetDeletionTable.key,
    })
    .from(schema.assetDeletionTable)
    .where(lt(schema.assetDeletionTable.attempts, MAX_ASSET_DELETION_ROUNDS));

  yield* scheduleAssetDeletions(pending);
});

export const scheduleAssetDeletions = (objects: readonly StoredObject[]) =>
  Effect.gen(function* () {
    if (objects.length === 0) {
      return;
    }
    const workflowEngine = yield* WorkflowEngine;
    yield* Effect.forEach(
      objects,
      (object) =>
        AssetDeletionWorkflow.execute(object, { discard: true }).pipe(
          Effect.provideService(WorkflowEngine, workflowEngine)
        ),
      { concurrency: DELETE_CONCURRENCY, discard: true }
    );
  });

export const deleteStoredAssets = (assets: readonly StoredAsset[]) =>
  transaction(stageAssetDeletions(assets)).pipe(
    Effect.andThen(scheduleAssetDeletions(assets))
  );

export const compensateUploadedAsset = (object: StoredObject, reason: string) =>
  queueObjectDeletions([object], reason).pipe(
    Effect.andThen(scheduleAssetDeletions([object])),
    Effect.catchCause((cause) =>
      Effect.logWarning(
        `Failed to compensate uploaded asset: ${object.key}`,
        cause
      )
    )
  );

export const AssetDeletionSweeperLayer = Layer.effectDiscard(
  sweepAssetDeletions.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Asset deletion sweep failed", cause)
    ),
    Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
    Effect.forkScoped({ startImmediately: true })
  )
);
