import { currentDb, schema } from "@feeblo/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { S3UploadService, S3UploadServiceLive } from "../services/s3";

type AssetKind =
  | "profile_image"
  | "organization_logo"
  | "editor_image"
  | "editor_video";

interface TAssetFindByOwnerAndKind {
  kind: AssetKind;
  organizationId?: string;
  userId?: string;
}

const ASSET_URL_REGEX = /https?:\/\/[^\s"'<>]+/g;

export const extractAssetUrlsFromContent = (content: string): string[] => [
  ...new Set(content.match(ASSET_URL_REGEX) ?? []),
];

const makeAssetRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findByOwnerAndKind: ({
      kind,
      userId,
      organizationId,
    }: TAssetFindByOwnerAndKind) =>
      db
        .select()
        .from(schema.assetTable)
        .where(
          and(
            eq(schema.assetTable.kind, kind),
            userId === undefined
              ? isNull(schema.assetTable.userId)
              : eq(schema.assetTable.userId, userId),
            organizationId === undefined
              ? isNull(schema.assetTable.organizationId)
              : eq(schema.assetTable.organizationId, organizationId)
          )
        ),
    findByUrls: (urls: string[]) =>
      urls.length === 0
        ? Effect.succeed([])
        : db
            .select()
            .from(schema.assetTable)
            .where(inArray(schema.assetTable.url, urls)),
    deleteByIds: (ids: string[]) =>
      ids.length === 0
        ? Effect.succeed([])
        : db
            .delete(schema.assetTable)
            .where(inArray(schema.assetTable.id, ids)),
  };
});

export class AssetRepository extends Context.Service<AssetRepository>()(
  "AssetRepository",
  {
    make: makeAssetRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

export const deleteAssetRows = (assets: readonly { id: string }[]) =>
  Effect.gen(function* () {
    const repository = yield* AssetRepository;
    yield* repository.deleteByIds(assets.map(({ id }) => id));
  });

export const deleteStoredAssets = (
  assets: readonly { id: string; key: string }[]
) =>
  Effect.gen(function* () {
    yield* deleteAssetRows(assets);
    yield* deleteBucketObjects(assets.map(({ key }) => key));
  });

export const deleteBucketObjects = (keys: readonly string[]) =>
  Effect.gen(function* () {
    if (keys.length === 0) {
      return;
    }
    const s3Service = yield* S3UploadService.pipe(
      Effect.provide(S3UploadServiceLive)
    );
    yield* Effect.forEach(keys, (key) =>
      s3Service
        .deleteObject(key)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Failed to delete S3 object: ${key}`, cause)
          )
        )
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to clean up bucket objects", cause)
    )
  );
