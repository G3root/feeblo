import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as S from "effect/Schema";
import * as W from "effect/unstable/workflow";

import { S3UploadService } from "../services/s3";
import {
  clearObjectDeletion,
  getObjectDeletionAttempts,
  MAX_ASSET_DELETION_ROUNDS,
  recordObjectDeletionFailure,
} from "./deletion-repository";

const RETRY_DELAY = "1 minute";

class AssetDeletionAttemptError extends S.TaggedErrorClass<AssetDeletionAttemptError>()(
  "AssetDeletionAttemptError",
  {
    message: S.String,
  }
) {}

export const AssetDeletionWorkflow = W.Workflow.make({
  name: "AssetDeletionWorkflow",
  payload: {
    bucket: S.String,
    key: S.String,
  },
  error: S.String,
  idempotencyKey: ({ bucket, key }) => `${bucket}:${key}`,
});

export const AssetDeletionWorkflowLayer = AssetDeletionWorkflow.toLayer(
  Effect.fnUntraced(function* (payload, executionId) {
    yield* Effect.annotateLogsScoped({
      bucket: payload.bucket,
      key: payload.key,
      executionId,
    });

    while (true) {
      const attempts = yield* getObjectDeletionAttempts(payload).pipe(
        Effect.mapError((error) => String(error))
      );
      if (attempts === undefined) {
        return;
      }
      if (attempts >= MAX_ASSET_DELETION_ROUNDS) {
        yield* Effect.logError("Asset deletion retry limit reached").pipe(
          Effect.annotateLogs({
            bucket: payload.bucket,
            key: payload.key,
            attempts,
          })
        );
        return;
      }

      const attempt = yield* Effect.result(
        W.Activity.make({
          name: `DeleteAssetObject-${attempts}`,
          error: AssetDeletionAttemptError,
          execute: Effect.gen(function* () {
            const s3Service = yield* S3UploadService;
            yield* s3Service
              .deleteObject(payload.bucket, payload.key)
              .pipe(
                Effect.mapError(
                  (error) =>
                    new AssetDeletionAttemptError({ message: String(error) })
                )
              );
            yield* clearObjectDeletion(payload).pipe(
              Effect.mapError(
                (error) =>
                  new AssetDeletionAttemptError({ message: String(error) })
              )
            );
          }),
        }).pipe(W.Activity.retry({ times: 3 }))
      );

      if (Result.isSuccess(attempt)) {
        return;
      }

      yield* recordObjectDeletionFailure(payload, attempt.failure.message).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to persist asset deletion retry", cause)
        )
      );
      yield* W.DurableClock.sleep({
        name: `asset-deletion-retry-${payload.bucket}-${payload.key}-${attempts}`,
        duration: RETRY_DELAY,
      });
    }
  })
);
