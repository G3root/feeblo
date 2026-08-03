import { currentDb, schema, transaction } from "@feeblo/db";
import { AssetId } from "@feeblo/id";
import * as Effect from "effect/Effect";

import { S3UploadService } from "../services/s3";
import { type AssetKind, type AssetOwner, AssetRepository } from "./repository";

interface UploadedAsset {
  readonly bucket: string;
  readonly key: string;
  readonly url: string;
}

const insertAsset = ({
  id,
  owner,
  kind,
  uploaded,
}: {
  readonly id: string;
  readonly owner: AssetOwner;
  readonly kind: AssetKind;
  readonly uploaded: UploadedAsset;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db.insert(schema.assetTable).values({
      id,
      bucket: uploaded.bucket,
      key: uploaded.key,
      url: uploaded.url,
      kind,
      ...(owner.type === "user"
        ? { userId: owner.id }
        : { organizationId: owner.id }),
    });
  });

const deleteObjectBestEffort = (
  object: Pick<UploadedAsset, "bucket" | "key">,
  message: string
) =>
  Effect.gen(function* () {
    const s3 = yield* S3UploadService;
    yield* s3.deleteObject(object.bucket, object.key);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(message, cause).pipe(
        Effect.annotateLogs({ bucket: object.bucket, key: object.key })
      )
    )
  );

export const registerUploadedAsset = ({
  owner,
  kind,
  uploaded,
}: {
  readonly owner: AssetOwner;
  readonly kind: AssetKind;
  readonly uploaded: UploadedAsset;
}) =>
  Effect.gen(function* () {
    yield* insertAsset({
      id: yield* AssetId.generate,
      owner,
      kind,
      uploaded,
    });
    return uploaded;
  }).pipe(
    Effect.tapCause(() =>
      deleteObjectBestEffort(
        uploaded,
        "Failed to remove an unregistered uploaded asset"
      )
    )
  );

export const replaceSingletonAsset = <E, R>({
  owner,
  kind,
  uploaded,
  updateOwner,
}: {
  readonly owner: AssetOwner;
  readonly kind: Extract<AssetKind, "profile_image" | "organization_logo">;
  readonly uploaded: UploadedAsset;
  readonly updateOwner: Effect.Effect<unknown, E, R>;
}) =>
  Effect.gen(function* () {
    const repository = yield* AssetRepository;
    const previousAssets = yield* Effect.tapCause(
      transaction(
        Effect.gen(function* () {
          const previousAssets = yield* repository.findByOwnerAndKind({
            kind,
            owner,
          });

          yield* updateOwner;
          yield* insertAsset({
            id: yield* AssetId.generate,
            owner,
            kind,
            uploaded,
          });
          yield* repository.deleteByIds(
            previousAssets.map(({ id }) => id)
          );

          return previousAssets;
        })
      ),
      () =>
        deleteObjectBestEffort(
          uploaded,
          "Failed to remove an unregistered singleton asset"
        )
    );

    yield* Effect.forEach(
      previousAssets,
      (asset) =>
        deleteObjectBestEffort(asset, "Failed to remove a replaced asset"),
      { discard: true }
    );

    return uploaded;
  });
