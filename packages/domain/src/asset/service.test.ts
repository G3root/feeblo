import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { S3UploadService } from "../services/s3";
import { AssetRepository } from "./repository";
import {
  cleanupOrphanedEditorAssets,
  cleanupPreparedEditorAssets,
  commitPreparedEditorAssets,
  prepareEditorAssetContent,
  registerUploadedAsset,
  replaceSingletonAsset,
  syncChangelogAssetReferences,
  syncPostAssetReferences,
} from "./service";

describe("registerUploadedAsset", () => {
  const S3Test = Layer.succeed(S3UploadService, {
    uploadProfileImage: () => Effect.die("not used in this test"),
    uploadOrganizationLogo: () => Effect.die("not used in this test"),
    uploadEditorMedia: () => Effect.die("not used in this test"),
    promoteEditorMedia: () => Effect.die("not used in this test"),
    deleteObject: () => Effect.succeed({ $metadata: { httpStatusCode: 204 } }),
  });
  const RepositoryTest = AssetRepository.layer.pipe(
    Layer.provide(Database.PgliteDatabaseLive)
  );
  const TestLayer = Layer.mergeAll(
    Database.PgliteDatabaseLive,
    RepositoryTest,
    S3Test
  );

  layer(TestLayer)("editor media", (it) => {
    const recordingS3 = (deletedKeys: Ref.Ref<string[]>) => ({
      uploadProfileImage: () => Effect.die("not used in this test"),
      uploadOrganizationLogo: () => Effect.die("not used in this test"),
      uploadEditorMedia: () => Effect.die("not used in this test"),
      promoteEditorMedia: () => Effect.die("not used in this test"),
      deleteObject: (_bucket: string, key: string) =>
        Ref.update(deletedKeys, (keys) => [...keys, key]).pipe(
          Effect.as({ $metadata: { httpStatusCode: 204 } })
        ),
    });

    it.effect("keeps prior assets when another asset is registered", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const userId = "user_editor_assets";

        yield* db.insert(schema.userTable).values({
          id: userId,
          email: "editor-assets@example.com",
          name: "Editor Assets",
        });

        for (const index of [1, 2]) {
          yield* registerUploadedAsset({
            owner: { type: "user", id: userId },
            kind: "editor_image",
            uploaded: {
              bucket: "test-bucket",
              key: `editor-media/${userId}/image-${index}.png`,
              url: `https://assets.example/image-${index}.png`,
            },
          });
        }

        const assets = yield* db
          .select({ url: schema.assetTable.url })
          .from(schema.assetTable)
          .where(eq(schema.assetTable.userId, userId));

        expect(assets.map(({ url }) => url).sort()).toEqual([
          "https://assets.example/image-1.png",
          "https://assets.example/image-2.png",
        ]);
      })
    );

    it.effect("tracks shared post and changelog asset references", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const now = new Date();
        const organizationId = "org_asset_references";
        const boardId = "board_asset_references";
        const statusId = "status_asset_references";
        const postId = "post_asset_references";
        const changelogId = "changelog_asset_references";

        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Asset References",
          slug: organizationId,
          createdAt: now,
        });
        yield* db.insert(schema.boardTable).values({
          id: boardId,
          name: "Asset References",
          slug: boardId,
          visibility: "PUBLIC",
          organizationId,
          createdAt: now,
          updatedAt: now,
        });
        yield* db.insert(schema.postStatusTable).values({
          id: statusId,
          type: "PENDING",
          orderIndex: 0,
          organizationId,
        });
        yield* db.insert(schema.postTable).values({
          id: postId,
          title: "Asset references",
          slug: postId,
          content: "",
          boardId,
          statusId,
          organizationId,
          createdAt: now,
          updatedAt: now,
        });
        yield* db.insert(schema.changelogTable).values({
          id: changelogId,
          title: "Asset references",
          slug: changelogId,
          content: "",
          organizationId,
          createdAt: now,
          updatedAt: now,
        });
        yield* db.insert(schema.assetTable).values([
          {
            id: "asset_shared_reference",
            bucket: "test-bucket",
            key: "editor-media/shared.png",
            url: "https://assets.example/shared.png",
            kind: "editor_image",
            organizationId,
          },
          {
            id: "asset_changelog_reference",
            bucket: "test-bucket",
            key: "editor-media/changelog.png",
            url: "https://assets.example/changelog.png",
            kind: "editor_image",
            organizationId,
          },
        ]);

        yield* syncPostAssetReferences({
          postId,
          organizationId,
          content: "![shared](https://assets.example/shared.png)",
          assetIds: [],
        });
        const urlOnlyRefs = yield* db
          .select({ assetId: schema.postAssetTable.assetId })
          .from(schema.postAssetTable)
          .where(eq(schema.postAssetTable.postId, postId));
        expect(urlOnlyRefs).toEqual([]);

        yield* syncPostAssetReferences({
          postId,
          organizationId,
          content: "![shared](https://assets.example/shared.png)",
          assetIds: ["asset_shared_reference"],
        });
        yield* syncChangelogAssetReferences({
          changelogId,
          organizationId,
          content:
            "![shared](https://assets.example/shared.png) ![other](https://assets.example/changelog.png)",
          assetIds: ["asset_shared_reference", "asset_changelog_reference"],
        });

        yield* db
          .delete(schema.postTable)
          .where(eq(schema.postTable.id, postId));

        const remainingChangelogRefs = yield* db
          .select({ assetId: schema.changelogAssetTable.assetId })
          .from(schema.changelogAssetTable)
          .where(eq(schema.changelogAssetTable.changelogId, changelogId));
        const remainingPostRefs = yield* db
          .select({ assetId: schema.postAssetTable.assetId })
          .from(schema.postAssetTable)
          .where(eq(schema.postAssetTable.postId, postId));

        expect(
          remainingChangelogRefs.map(({ assetId }) => assetId).sort()
        ).toEqual(["asset_changelog_reference", "asset_shared_reference"]);
        expect(remainingPostRefs).toEqual([]);

        yield* db
          .delete(schema.changelogTable)
          .where(eq(schema.changelogTable.id, changelogId));

        const remainingRefs = yield* db
          .select({ assetId: schema.changelogAssetTable.assetId })
          .from(schema.changelogAssetTable)
          .where(eq(schema.changelogAssetTable.changelogId, changelogId));
        expect(remainingRefs).toEqual([]);
      })
    );

    it.effect("promotes temporary editor assets on save", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const now = new Date();
        const organizationId = "org_asset_promotion";
        const deletedKeys = yield* Ref.make<string[]>([]);

        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Asset Promotion",
          slug: organizationId,
          createdAt: now,
        });
        yield* db.insert(schema.assetTable).values({
          id: "asset_temporary_editor",
          bucket: "test-bucket",
          key: "tmp/editor-media/user/image/file.png",
          url: "https://assets.example/tmp/file.png",
          kind: "editor_image",
          organizationId,
        });

        const s3 = {
          uploadProfileImage: () => Effect.die("not used in this test"),
          uploadOrganizationLogo: () => Effect.die("not used in this test"),
          uploadEditorMedia: () => Effect.die("not used in this test"),
          promoteEditorMedia: () =>
            Effect.succeed({
              bucket: "test-bucket",
              key: "editor-media/user/image/file.png",
              url: "https://assets.example/file.png",
            }),
          deleteObject: (_bucket: string, key: string) =>
            Ref.update(deletedKeys, (keys) => [...keys, key]).pipe(
              Effect.as({ $metadata: { httpStatusCode: 204 } })
            ),
        };

        const prepared = yield* prepareEditorAssetContent({
          organizationId,
          content: "![image](https://assets.example/tmp/file.png)",
          assetIds: ["asset_temporary_editor"],
        }).pipe(Effect.provideService(S3UploadService, s3));

        expect(prepared.content).toBe(
          "![image](https://assets.example/file.png)"
        );
        yield* commitPreparedEditorAssets(prepared.promotions);
        yield* cleanupPreparedEditorAssets(prepared.promotions).pipe(
          Effect.provideService(S3UploadService, s3)
        );

        const [asset] = yield* db
          .select({ key: schema.assetTable.key, url: schema.assetTable.url })
          .from(schema.assetTable)
          .where(eq(schema.assetTable.id, "asset_temporary_editor"));

        expect(asset).toEqual({
          key: "editor-media/user/image/file.png",
          url: "https://assets.example/file.png",
        });
        expect(yield* Ref.get(deletedKeys)).toEqual([
          "tmp/editor-media/user/image/file.png",
        ]);
      })
    );

    it.effect("removes completed copies when a later promotion fails", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const organizationId = "org_failed_asset_promotion";
        const deletedKeys = yield* Ref.make<string[]>([]);

        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Failed Asset Promotion",
          slug: organizationId,
          createdAt: new Date(),
        });
        yield* db.insert(schema.assetTable).values([
          {
            id: "asset_promoted_before_failure",
            bucket: "test-bucket",
            key: "tmp/editor-media/user/image/first.png",
            url: "https://assets.example/tmp/first.png",
            kind: "editor_image",
            organizationId,
          },
          {
            id: "asset_failed_promotion",
            bucket: "test-bucket",
            key: "tmp/editor-media/user/image/second.png",
            url: "https://assets.example/tmp/second.png",
            kind: "editor_image",
            organizationId,
          },
        ]);

        const result = yield* prepareEditorAssetContent({
          organizationId,
          content:
            "![first](https://assets.example/tmp/first.png) ![second](https://assets.example/tmp/second.png)",
          assetIds: [
            "asset_promoted_before_failure",
            "asset_failed_promotion",
          ],
        }).pipe(
          Effect.provideService(S3UploadService, {
            uploadProfileImage: () => Effect.die("not used in this test"),
            uploadOrganizationLogo: () => Effect.die("not used in this test"),
            uploadEditorMedia: () => Effect.die("not used in this test"),
            promoteEditorMedia: ({ key }) =>
              key.endsWith("second.png")
                ? Effect.die("copy failed")
                : Effect.succeed({
                    bucket: "test-bucket",
                    key: "editor-media/user/image/first.png",
                    url: "https://assets.example/first.png",
                  }),
            deleteObject: (_bucket, key) =>
              Ref.update(deletedKeys, (keys) => [...keys, key]).pipe(
                Effect.as({ $metadata: { httpStatusCode: 204 } })
              ),
          }),
          Effect.exit
        );

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* Ref.get(deletedKeys)).toEqual([
          "editor-media/user/image/first.png",
        ]);
      })
    );

    it.effect("removes committed editor assets with no references", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const now = new Date();
        const organizationId = "org_orphaned_editor_assets";
        const deletedKeys = yield* Ref.make<string[]>([]);

        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Orphaned Editor Assets",
          slug: organizationId,
          createdAt: now,
        });
        yield* db.insert(schema.assetTable).values({
          id: "asset_orphaned_editor",
          bucket: "test-bucket",
          key: "editor-media/user/image/orphaned.png",
          url: "https://assets.example/orphaned.png",
          kind: "editor_image",
          organizationId,
        });

        const s3 = recordingS3(deletedKeys);
        yield* cleanupOrphanedEditorAssets({ organizationId }).pipe(
          Effect.provideService(S3UploadService, s3)
        );

        const assets = yield* db
          .select({ id: schema.assetTable.id })
          .from(schema.assetTable)
          .where(eq(schema.assetTable.id, "asset_orphaned_editor"));
        expect(assets).toEqual([]);
        expect(yield* Ref.get(deletedKeys)).toEqual([
          "editor-media/user/image/orphaned.png",
        ]);
      })
    );

    it.effect("replaces only the previous singleton asset", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const userId = "user_profile_asset";
        const deletedKeys = yield* Ref.make<string[]>([]);

        yield* db.insert(schema.userTable).values({
          id: userId,
          email: "profile-asset@example.com",
          name: "Profile Asset",
          image: "https://assets.example/old.png",
        });
        yield* db.insert(schema.assetTable).values({
          id: "asset_old_profile",
          bucket: "test-bucket",
          key: "profile-images/old.png",
          url: "https://assets.example/old.png",
          kind: "profile_image",
          userId,
        });

        yield* replaceSingletonAsset({
          owner: { type: "user", id: userId },
          kind: "profile_image",
          uploaded: {
            bucket: "test-bucket",
            key: "profile-images/new.png",
            url: "https://assets.example/new.png",
          },
          updateOwner: db
            .update(schema.userTable)
            .set({ image: "https://assets.example/new.png" })
            .where(eq(schema.userTable.id, userId)),
        }).pipe(
          Effect.provideService(S3UploadService, {
            uploadProfileImage: () => Effect.die("not used in this test"),
            uploadOrganizationLogo: () => Effect.die("not used in this test"),
            uploadEditorMedia: () => Effect.die("not used in this test"),
            promoteEditorMedia: () => Effect.die("not used in this test"),
            deleteObject: (_bucket, key) =>
              Ref.update(deletedKeys, (keys) => [...keys, key]).pipe(
                Effect.as({ $metadata: { httpStatusCode: 204 } })
              ),
          })
        );

        const assets = yield* db
          .select({ key: schema.assetTable.key })
          .from(schema.assetTable)
          .where(eq(schema.assetTable.userId, userId));

        expect(assets).toEqual([{ key: "profile-images/new.png" }]);
        expect(yield* Ref.get(deletedKeys)).toEqual(["profile-images/old.png"]);
      })
    );

    it.effect(
      "removes the uploaded object when registering a duplicate asset fails",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const userId = "user_duplicate_assets";
          const deletedKeys = yield* Ref.make<string[]>([]);

          yield* db.insert(schema.userTable).values({
            id: userId,
            email: "duplicate-assets@example.com",
            name: "Duplicate Assets",
          });

          const uploaded = {
            bucket: "test-bucket",
            key: `editor-media/${userId}/duplicate.png`,
            url: "https://assets.example/duplicate.png",
          };

          yield* registerUploadedAsset({
            owner: { type: "user", id: userId },
            kind: "editor_image",
            uploaded,
          });

          const result = yield* registerUploadedAsset({
            owner: { type: "user", id: userId },
            kind: "editor_image",
            uploaded,
          }).pipe(
            Effect.provideService(S3UploadService, recordingS3(deletedKeys)),
            Effect.exit
          );

          expect(Exit.isFailure(result)).toBe(true);
          expect(yield* Ref.get(deletedKeys)).toEqual([uploaded.key]);
        })
    );

    it.effect(
      "removes the uploaded object when the singleton owner update fails",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const userId = "user_failed_update";
          const deletedKeys = yield* Ref.make<string[]>([]);

          yield* db.insert(schema.userTable).values({
            id: userId,
            email: "failed-update@example.com",
            name: "Failed Update",
            image: "https://assets.example/old.png",
          });
          yield* db.insert(schema.assetTable).values({
            id: "asset_old_failed",
            bucket: "test-bucket",
            key: "profile-images/old.png",
            url: "https://assets.example/old.png",
            kind: "profile_image",
            userId,
          });

          const result = yield* replaceSingletonAsset({
            owner: { type: "user", id: userId },
            kind: "profile_image",
            uploaded: {
              bucket: "test-bucket",
              key: "profile-images/new.png",
              url: "https://assets.example/new.png",
            },
            updateOwner: Effect.die("owner update failed"),
          }).pipe(
            Effect.provideService(S3UploadService, recordingS3(deletedKeys)),
            Effect.exit
          );

          expect(Exit.isFailure(result)).toBe(true);
          expect(yield* Ref.get(deletedKeys)).toEqual([
            "profile-images/new.png",
          ]);

          const assets = yield* db
            .select({ key: schema.assetTable.key })
            .from(schema.assetTable)
            .where(eq(schema.assetTable.userId, userId));

          expect(assets).toEqual([{ key: "profile-images/old.png" }]);
        })
    );
  });
});
