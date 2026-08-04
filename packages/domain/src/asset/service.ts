import { currentDb, schema, transaction } from "@feeblo/db";
import { AssetId } from "@feeblo/id";
import { and, eq, inArray, lt, notExists, or } from "drizzle-orm";
import type * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { InternalServerError } from "../rpc-errors";
import { isTemporaryEditorMediaKey, S3UploadService } from "../services/s3";
import { type AssetKind, type AssetOwner, AssetRepository } from "./repository";

const EDITOR_ASSET_KINDS = ["editor_image", "editor_video"] as const;
// TODO: Move to two-phase deletion if aged orphan reuse becomes supported.
// Cleanup can still win the lock race against a concurrent reference insert
// after this grace period, causing that save to fail its foreign-key check.
const ORPHANED_EDITOR_ASSET_GRACE_PERIOD = Duration.hours(1);

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
          yield* updateOwner;
          const previousAssets = yield* repository.findByOwnerAndKind({
            kind,
            owner,
          });

          yield* repository.deleteByIds(previousAssets.map(({ id }) => id));
          yield* insertAsset({
            id: yield* AssetId.generate,
            owner,
            kind,
            uploaded,
          });

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
  userId,
  assetIds,
}: {
  readonly organizationId: string;
  readonly userId?: string;
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
          userId
            ? or(
                eq(schema.assetTable.organizationId, organizationId),
                eq(schema.assetTable.userId, userId)
              )
            : eq(schema.assetTable.organizationId, organizationId),
          inArray(schema.assetTable.kind, EDITOR_ASSET_KINDS),
          inArray(schema.assetTable.id, assetIds)
        )
      );

    return assets;
  });

const findCurrentEditorAssetsInContent = ({
  organizationId,
  userId,
  content,
  currentAssetIds,
}: {
  readonly organizationId: string;
  readonly userId?: string;
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
          userId
            ? or(
                eq(schema.assetTable.organizationId, organizationId),
                eq(schema.assetTable.userId, userId)
              )
            : eq(schema.assetTable.organizationId, organizationId),
          inArray(schema.assetTable.kind, EDITOR_ASSET_KINDS),
          inArray(schema.assetTable.id, currentAssetIds)
        )
      );

    return assets.filter(({ url }) => content.includes(url));
  });

export const prepareEditorAssetContent = ({
  organizationId,
  userId,
  content,
  assetIds,
}: {
  readonly organizationId: string;
  readonly userId?: string;
  readonly content: string;
  readonly assetIds: readonly string[];
}) =>
  Effect.gen(function* () {
    const assets = yield* findEditorAssetsByIds({
      organizationId,
      ...(userId ? { userId } : {}),
      assetIds,
    });
    const temporaryAssets = assets.filter(({ key }) =>
      isTemporaryEditorMediaKey(key)
    );

    if (temporaryAssets.length === 0) {
      return { content, promotions: [] as readonly PromotedEditorAsset[] };
    }

    const s3 = yield* S3UploadService;
    const completedPromotions: PromotedEditorAsset[] = [];
    const promotions = yield* Effect.forEach(temporaryAssets, (asset) =>
      s3.promoteEditorMedia({ bucket: asset.bucket, key: asset.key }).pipe(
        Effect.map((permanentObject) => ({
          asset,
          temporaryObject: { bucket: asset.bucket, key: asset.key },
          permanentObject,
        })),
        Effect.tap((promotion) =>
          Effect.sync(() => {
            completedPromotions.push(promotion);
          })
        )
      )
    ).pipe(
      Effect.onError(() => rollbackPreparedEditorAssets(completedPromotions)),
      Effect.mapError(
        () =>
          new InternalServerError({
            message: "Failed to promote temporary editor asset",
          })
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

const syncReferences = <E1, R1, E2, R2, E3, R3>({
  assets,
  findCurrent,
  deleteStale,
  insertNew,
}: {
  readonly assets: readonly EditorAsset[];
  readonly findCurrent: Effect.Effect<
    readonly { readonly assetId: string }[],
    E1,
    R1
  >;
  readonly deleteStale: (
    assetIds: readonly string[]
  ) => Effect.Effect<unknown, E2, R2>;
  readonly insertNew: (
    assetIds: readonly string[]
  ) => Effect.Effect<unknown, E3, R3>;
}) =>
  Effect.gen(function* () {
    const assetIds = assets.map(({ id }) => id);
    const current = yield* findCurrent;
    const currentIds = current.map(({ assetId }) => assetId);
    const staleIds = currentIds.filter((id) => !assetIds.includes(id));
    const newIds = assetIds.filter((id) => !currentIds.includes(id));

    if (staleIds.length > 0) {
      yield* deleteStale(staleIds);
    }

    if (newIds.length > 0) {
      yield* insertNew(newIds);
    }
  });

const syncPostReferences = ({
  postId,
  assets,
}: {
  readonly postId: string;
  readonly assets: readonly EditorAsset[];
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* syncReferences({
      assets,
      findCurrent: db
        .select({ assetId: schema.postAssetTable.assetId })
        .from(schema.postAssetTable)
        .where(eq(schema.postAssetTable.postId, postId)),
      deleteStale: (assetIds) =>
        db
          .delete(schema.postAssetTable)
          .where(
            and(
              eq(schema.postAssetTable.postId, postId),
              inArray(schema.postAssetTable.assetId, assetIds)
            )
          ),
      insertNew: (assetIds) =>
        db
          .insert(schema.postAssetTable)
          .values(assetIds.map((assetId) => ({ postId, assetId })))
          .onConflictDoNothing(),
    });
  });

const syncChangelogReferences = ({
  changelogId,
  assets,
}: {
  readonly changelogId: string;
  readonly assets: readonly EditorAsset[];
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* syncReferences({
      assets,
      findCurrent: db
        .select({ assetId: schema.changelogAssetTable.assetId })
        .from(schema.changelogAssetTable)
        .where(eq(schema.changelogAssetTable.changelogId, changelogId)),
      deleteStale: (assetIds) =>
        db
          .delete(schema.changelogAssetTable)
          .where(
            and(
              eq(schema.changelogAssetTable.changelogId, changelogId),
              inArray(schema.changelogAssetTable.assetId, assetIds)
            )
          ),
      insertNew: (assetIds) =>
        db
          .insert(schema.changelogAssetTable)
          .values(assetIds.map((assetId) => ({ changelogId, assetId })))
          .onConflictDoNothing(),
    });
  });

export const syncPostAssetReferences = ({
  postId,
  organizationId,
  userId,
  content,
  assetIds,
}: {
  readonly postId: string;
  readonly organizationId: string;
  readonly userId?: string;
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
      ...(userId ? { userId } : {}),
      content,
      currentAssetIds: current.map(({ assetId }) => assetId),
    });
    const submittedAssets = yield* findEditorAssetsByIds({
      organizationId,
      ...(userId ? { userId } : {}),
      assetIds,
    });
    const assets = [
      ...currentAssets,
      ...submittedAssets.filter(
        ({ id, url }) =>
          !currentAssets.some((asset) => asset.id === id) &&
          content.includes(url)
      ),
    ];
    yield* syncPostReferences({ postId, assets });
  });

export const syncChangelogAssetReferences = ({
  changelogId,
  organizationId,
  userId,
  content,
  assetIds,
}: {
  readonly changelogId: string;
  readonly organizationId: string;
  readonly userId?: string;
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
      ...(userId ? { userId } : {}),
      content,
      currentAssetIds: current.map(({ assetId }) => assetId),
    });
    const submittedAssets = yield* findEditorAssetsByIds({
      organizationId,
      ...(userId ? { userId } : {}),
      assetIds,
    });
    const assets = [
      ...currentAssets,
      ...submittedAssets.filter(
        ({ id, url }) =>
          !currentAssets.some((asset) => asset.id === id) &&
          content.includes(url)
      ),
    ];
    yield* syncChangelogReferences({ changelogId, assets });
  });

const unreferencedByPostOrChangelog = (db: PgDrizzle.EffectPgDatabase) =>
  and(
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
        .where(eq(schema.changelogAssetTable.assetId, schema.assetTable.id))
    )
  );

export const cleanupOrphanedEditorAssets = ({
  organizationId,
}: {
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const createdBefore = DateTime.toDate(
      DateTime.subtractDuration(
        yield* DateTime.now,
        ORPHANED_EDITOR_ASSET_GRACE_PERIOD
      )
    );
    const committedAssets = yield* transaction(
      Effect.gen(function* () {
        const db = yield* currentDb;
        const candidates = yield* db
          .select({ id: schema.assetTable.id })
          .from(schema.assetTable)
          .where(
            and(
              eq(schema.assetTable.organizationId, organizationId),
              inArray(schema.assetTable.kind, EDITOR_ASSET_KINDS),
              lt(schema.assetTable.createdAt, createdBefore),
              unreferencedByPostOrChangelog(db)
            )
          )
          .for("update", { skipLocked: true });

        if (candidates.length === 0) {
          return [];
        }

        const unreferenced = yield* db
          .select({
            id: schema.assetTable.id,
            bucket: schema.assetTable.bucket,
            key: schema.assetTable.key,
          })
          .from(schema.assetTable)
          .where(
            and(
              inArray(
                schema.assetTable.id,
                candidates.map(({ id }) => id)
              ),
              unreferencedByPostOrChangelog(db)
            )
          );
        const committed = unreferenced.filter(
          ({ key }) => !isTemporaryEditorMediaKey(key)
        );

        if (committed.length > 0) {
          yield* db.delete(schema.assetTable).where(
            inArray(
              schema.assetTable.id,
              committed.map(({ id }) => id)
            )
          );
        }

        return committed;
      })
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
