import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { S3UploadService } from "../services/s3";
import { AssetRepository } from "./repository";
import { registerUploadedAsset, replaceSingletonAsset } from "./service";

describe("registerUploadedAsset", () => {
  const S3Test = Layer.succeed(S3UploadService, {
    uploadProfileImage: () => Effect.die("not used in this test"),
    uploadOrganizationLogo: () => Effect.die("not used in this test"),
    uploadEditorMedia: () => Effect.die("not used in this test"),
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
