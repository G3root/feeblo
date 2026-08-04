import { currentDb, schema, transaction } from "@feeblo/db";
import { AssetId } from "@feeblo/id";
import { and, eq, inArray, notExists } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { isTemporaryEditorMediaKey, S3UploadService } from "../services/s3";
import { type AssetKind, type AssetOwner, AssetRepository } from "./repository";

const EDITOR_ASSET_KINDS = ["editor_image", "editor_video"] as const;

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
    const assetId = yield* AssetId.generate;
    yield* insertAsset({
      id: assetId,
      owner,
      kind,
      uploaded,
    });
    return { ...uploaded, assetId };
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
          yield* repository.deleteByIds(previousAssets.map(({ id }) => id));

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

type EditorAsset = {
  readonly id: string;
  readonly bucket: string;
  readonly key: string;
  readonly url: string;
};

export type PromotedEditorAsset = {
  readonly asset: EditorAsset;
  readonly temporaryObject: Pick<UploadedAsset, "bucket" | "key">;
  readonly permanentObject: UploadedAsset;
};

const findEditorAssetsByIds = ({
  organizationId,
  assetIds,
}: {
  readonly organizationId: string;
  readonly assetIds: readonly string[];
}) =>
  Effect.gen(function* () {
    if (assetIds.length === 0) {
      return [];
    }

    const db = yield* currentDb;
    const assets = yield* db
      .select({
        id: schema.assetTable.id,
        bucket: schema.assetTable.bucket,
        key: schema.assetTable.key,
        url: schema.assetTable.url,
      })
      .from(schema.assetTable)
      .where(
        and(
          eq(schema.assetTable.organizationId, organizationId),
          inArray(schema.assetTable.kind, EDITOR_ASSET_KINDS),
          inArray(schema.assetTable.id, assetIds)
        )
      );

    return assets;
  });

const findCurrentEditorAssetsInContent = ({
  organizationId,
  content,
  currentAssetIds,
}: {
  readonly organizationId: string;
  readonly content: string;
  readonly currentAssetIds: readonly string[];
}) =>
  Effect.gen(function* () {
    if (currentAssetIds.length === 0) {
      return [];
    }

    const db = yield* currentDb;
    const assets = yield* db
      .select({
        id: schema.assetTable.id,
        bucket: schema.assetTable.bucket,
        key: schema.assetTable.key,
        url: schema.assetTable.url,
      })
      .from(schema.assetTable)
      .where(
        and(
          eq(schema.assetTable.organizationId, organizationId),
          inArray(schema.assetTable.kind, EDITOR_ASSET_KINDS),
          inArray(schema.assetTable.id, currentAssetIds)
        )
      );

    return assets.filter(({ url }) => content.includes(url));
  });

export const prepareEditorAssetContent = ({
  organizationId,
  content,
  assetIds,
}: {
  readonly organizationId: string;
  readonly content: string;
  readonly assetIds: readonly string[];
}) =>
  Effect.gen(function* () {
    const assets = yield* findEditorAssetsByIds({ organizationId, assetIds });
    const temporaryAssets = assets.filter(({ key }) =>
      isTemporaryEditorMediaKey(key)
    );

    if (temporaryAssets.length === 0) {
      return { content, promotions: [] as readonly PromotedEditorAsset[] };
    }

    const s3 = yield* S3UploadService;
    const promotions = yield* Effect.forEach(temporaryAssets, (asset) =>
      s3.promoteEditorMedia({ bucket: asset.bucket, key: asset.key }).pipe(
        Effect.catchCause(() =>
          Effect.die("Failed to promote temporary editor asset")
        ),
        Effect.map((permanentObject) => ({
          asset,
          temporaryObject: { bucket: asset.bucket, key: asset.key },
          permanentObject,
        }))
      )
    );
    const rewrittenContent = promotions.reduce(
      (value, { asset, permanentObject }) =>
        value.split(asset.url).join(permanentObject.url),
      content
    );

    return { content: rewrittenContent, promotions };
  });

const commitEditorAssetPromotions = (
  promotions: readonly PromotedEditorAsset[]
) =>
  Effect.gen(function* () {
    if (promotions.length === 0) {
      return;
    }

    const db = yield* currentDb;
    yield* Effect.forEach(
      promotions,
      ({ asset, permanentObject }) =>
        db
          .update(schema.assetTable)
          .set({
            bucket: permanentObject.bucket,
            key: permanentObject.key,
            url: permanentObject.url,
          })
          .where(eq(schema.assetTable.id, asset.id)),
      { discard: true }
    );
  });

export const cleanupPreparedEditorAssets = (
  promotions: readonly PromotedEditorAsset[]
) =>
  Effect.forEach(
    promotions,
    ({ temporaryObject }) =>
      deleteObjectBestEffort(
        temporaryObject,
        "Failed to remove a promoted temporary editor asset"
      ),
    { discard: true }
  );

const syncPostReferences = ({
  postId,
  assets,
}: {
  readonly postId: string;
  readonly assets: readonly EditorAsset[];
}) =>
  Effect.gen(function* () {
    const assetIds = assets.map(({ id }) => id);
    const db = yield* currentDb;
    const current = yield* db
      .select({ assetId: schema.postAssetTable.assetId })
      .from(schema.postAssetTable)
      .where(eq(schema.postAssetTable.postId, postId));
    const currentIds = current.map(({ assetId }) => assetId);
    const staleIds = currentIds.filter((id) => !assetIds.includes(id));
    const newIds = assetIds.filter((id) => !currentIds.includes(id));

    if (staleIds.length > 0) {
      yield* db
        .delete(schema.postAssetTable)
        .where(
          and(
            eq(schema.postAssetTable.postId, postId),
            inArray(schema.postAssetTable.assetId, staleIds)
          )
        );
    }

    if (newIds.length > 0) {
      yield* db
        .insert(schema.postAssetTable)
        .values(newIds.map((assetId) => ({ postId, assetId })))
        .onConflictDoNothing();
    }
  });

const syncChangelogReferences = ({
  changelogId,
  assets,
}: {
  readonly changelogId: string;
  readonly assets: readonly EditorAsset[];
}) =>
  Effect.gen(function* () {
    const assetIds = assets.map(({ id }) => id);
    const db = yield* currentDb;
    const current = yield* db
      .select({ assetId: schema.changelogAssetTable.assetId })
      .from(schema.changelogAssetTable)
      .where(eq(schema.changelogAssetTable.changelogId, changelogId));
    const currentIds = current.map(({ assetId }) => assetId);
    const staleIds = currentIds.filter((id) => !assetIds.includes(id));
    const newIds = assetIds.filter((id) => !currentIds.includes(id));

    if (staleIds.length > 0) {
      yield* db
        .delete(schema.changelogAssetTable)
        .where(
          and(
            eq(schema.changelogAssetTable.changelogId, changelogId),
            inArray(schema.changelogAssetTable.assetId, staleIds)
          )
        );
    }

    if (newIds.length > 0) {
      yield* db
        .insert(schema.changelogAssetTable)
        .values(newIds.map((assetId) => ({ changelogId, assetId })))
        .onConflictDoNothing();
    }
  });

export const syncPostAssetReferences = ({
  postId,
  organizationId,
  content,
  assetIds,
}: {
  readonly postId: string;
  readonly organizationId: string;
  readonly content: string;
  readonly assetIds: readonly string[];
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const current = yield* db
      .select({ assetId: schema.postAssetTable.assetId })
      .from(schema.postAssetTable)
      .where(eq(schema.postAssetTable.postId, postId));
    const currentAssets = yield* findCurrentEditorAssetsInContent({
      organizationId,
      content,
      currentAssetIds: current.map(({ assetId }) => assetId),
    });
    const submittedAssets = yield* findEditorAssetsByIds({
      organizationId,
      assetIds,
    });
    const assets = [
      ...currentAssets,
      ...submittedAssets.filter(
        ({ id }) => !currentAssets.some((asset) => asset.id === id)
      ),
    ];
    yield* syncPostReferences({ postId, assets });
  });

export const syncChangelogAssetReferences = ({
  changelogId,
  organizationId,
  content,
  assetIds,
}: {
  readonly changelogId: string;
  readonly organizationId: string;
  readonly content: string;
  readonly assetIds: readonly string[];
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const current = yield* db
      .select({ assetId: schema.changelogAssetTable.assetId })
      .from(schema.changelogAssetTable)
      .where(eq(schema.changelogAssetTable.changelogId, changelogId));
    const currentAssets = yield* findCurrentEditorAssetsInContent({
      organizationId,
      content,
      currentAssetIds: current.map(({ assetId }) => assetId),
    });
    const submittedAssets = yield* findEditorAssetsByIds({
      organizationId,
      assetIds,
    });
    const assets = [
      ...currentAssets,
      ...submittedAssets.filter(
        ({ id }) => !currentAssets.some((asset) => asset.id === id)
      ),
    ];
    yield* syncChangelogReferences({ changelogId, assets });
  });

export const cleanupOrphanedEditorAssets = ({
  organizationId,
}: {
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const assets = yield* db
      .select({
        id: schema.assetTable.id,
        bucket: schema.assetTable.bucket,
        key: schema.assetTable.key,
      })
      .from(schema.assetTable)
      .where(
        and(
          eq(schema.assetTable.organizationId, organizationId),
          inArray(schema.assetTable.kind, EDITOR_ASSET_KINDS),
          notExists(
            db
              .select({ assetId: schema.postAssetTable.assetId })
              .from(schema.postAssetTable)
              .where(eq(schema.postAssetTable.assetId, schema.assetTable.id))
          ),
          notExists(
            db
              .select({ assetId: schema.changelogAssetTable.assetId })
              .from(schema.changelogAssetTable)
              .where(
                eq(schema.changelogAssetTable.assetId, schema.assetTable.id)
              )
          )
        )
      );
    const committedAssets = assets.filter(
      ({ key }) => !isTemporaryEditorMediaKey(key)
    );

    if (committedAssets.length === 0) {
      return;
    }

    yield* Effect.forEach(
      committedAssets,
      (asset) =>
        deleteObjectBestEffort(
          asset,
          "Failed to remove an orphaned editor asset"
        ),
      { discard: true }
    );
    yield* db.delete(schema.assetTable).where(
      inArray(
        schema.assetTable.id,
        committedAssets.map(({ id }) => id)
      )
    );
  });

export const commitPreparedEditorAssets = (
  promotions: readonly PromotedEditorAsset[]
) => commitEditorAssetPromotions(promotions);

export const rollbackPreparedEditorAssets = (
  promotions: readonly PromotedEditorAsset[]
) =>
  Effect.forEach(
    promotions,
    ({ permanentObject }) =>
      deleteObjectBestEffort(
        permanentObject,
        "Failed to remove a failed editor asset promotion"
      ),
    { discard: true }
  );
