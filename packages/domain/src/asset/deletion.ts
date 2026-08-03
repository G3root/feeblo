import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { queueObjectDeletions, type StoredObject } from "./deletion-repository";
import { AssetRepository } from "./repository";
import { AssetDeletionWorkflow } from "./workflow";

export interface StoredAsset extends StoredObject {
  readonly id: string;
}

const DELETE_CONCURRENCY = 10;

export const stageAssetDeletions = (assets: readonly StoredAsset[]) =>
  Effect.gen(function* () {
    const repository = yield* AssetRepository;
    yield* repository.deleteByIds(assets.map(({ id }) => id));
    yield* queueObjectDeletions(assets);
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
