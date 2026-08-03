import { currentDb, schema, transaction } from "@feeblo/db";
import { AssetId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { AssetRepository, deleteBucketObjects } from "../asset/repository";
import { Api } from "../http/api";
import {
  BadRequestError,
  InternalServerError,
  withRemapDbErrors,
} from "../rpc-errors";
import { S3UploadService, S3UploadServiceLive } from "../services/s3";
import {
  currentHttpApiSession,
  HttpApiAuthMiddlewareLive,
} from "../session-middleware";

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const ProfileApiLive = HttpApiBuilder.group(
  Api,
  "ProfileApiGroup",
  (handlers) =>
    handlers.handle("uploadProfilePicture", ({ payload: { file } }) => {
      return Effect.gen(function* () {
        const session = yield* currentHttpApiSession;

        if (!ALLOWED_CONTENT_TYPES.has(file.contentType)) {
          return yield* new BadRequestError({
            message: "Unsupported file type. Use JPEG, PNG, or WEBP",
          });
        }

        const extension = getFileExtension(file.contentType);
        if (!extension) {
          return yield* new BadRequestError({
            message: "Unsupported file type. Use JPEG, PNG, or WEBP",
          });
        }

        const fs = yield* FileSystem.FileSystem;
        const bytes = yield* fs
          .readFile(file.path)
          .pipe(
            Effect.mapError(
              () => new InternalServerError({ message: "Failed to read file" })
            )
          );

        if (bytes.length === 0 || bytes.length > MAX_PROFILE_IMAGE_BYTES) {
          return yield* new BadRequestError({
            message: "Profile image must be between 1B and 5MB",
          });
        }

        const s3Service = yield* S3UploadService.pipe(
          Effect.provide(S3UploadServiceLive),
          Effect.mapError(
            () =>
              new InternalServerError({
                message: "Failed to configure media storage",
              })
          )
        );
        const uploaded = yield* s3Service
          .uploadProfileImage({
            bytes,
            extension,
            userId: session.user.id,
          })
          .pipe(
            Effect.mapError(
              () =>
                new InternalServerError({ message: "Failed to upload image" })
            )
          );

        const db = yield* currentDb;
        const assetRepository = yield* AssetRepository;
        const assetId = yield* AssetId.generate;
        const previousAssets = yield* assetRepository.findByOwnerAndKind({
          userId: session.user.id,
          kind: "profile_image",
        });
        const obsoleteAssets = previousAssets.filter(
          ({ key }) => key !== uploaded.key
        );

        yield* transaction(
          Effect.gen(function* () {
            yield* db
              .update(schema.userTable)
              .set({ image: uploaded.url })
              .where(eq(schema.userTable.id, session.user.id));

            yield* db.insert(schema.assetTable).values({
              id: assetId,
              bucket: uploaded.bucket,
              key: uploaded.key,
              url: uploaded.url,
              kind: "profile_image",
              userId: session.user.id,
            });

            yield* assetRepository.deleteByIds(
              obsoleteAssets.map(({ id }) => id)
            );
          })
        );

        yield* deleteBucketObjects(obsoleteAssets.map(({ key }) => key));

        return uploaded;
      }).pipe(
        Effect.provide(AssetRepository.layer),
        withRemapDbErrors("UserProfile", "create")
      );
    })
).pipe(Layer.provide(HttpApiAuthMiddlewareLive));

function getFileExtension(contentType: string): string | null {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}
