import { currentDb, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { AssetRepository } from "../asset/repository";
import { replaceSingletonAsset } from "../asset/service";
import { Api } from "../http/api";
import { UploadLimitsMiddlewareLive } from "../http/upload-limits";
import { sniffMediaType } from "../media/api-live";
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

        // Check the on-disk size before reading the file into memory so an
        // oversized upload cannot exhaust server memory.
        const fileInfo = yield* fs
          .stat(file.path)
          .pipe(
            Effect.mapError(
              () => new InternalServerError({ message: "Failed to read file" })
            )
          );
        const maxSize = FileSystem.Size(MAX_PROFILE_IMAGE_BYTES);
        if (fileInfo.size === FileSystem.Size(0) || fileInfo.size > maxSize) {
          return yield* new BadRequestError({
            message: "Profile image must be between 1B and 5MB",
          });
        }

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

        // Match the media upload path: verify the declared Content-Type against
        // the file's magic bytes so arbitrary payloads are never stored as
        // "images" in the public-read bucket.
        const sniffedContentType = sniffMediaType(bytes);
        if (
          sniffedContentType === null ||
          sniffedContentType !== file.contentType
        ) {
          return yield* new BadRequestError({
            message:
              "File content does not match its declared type. Use JPEG, PNG, or WEBP",
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

        yield* replaceSingletonAsset({
          owner: { type: "user", id: session.user.id },
          kind: "profile_image",
          uploaded,
          updateOwner: Effect.gen(function* () {
            const db = yield* currentDb;
            yield* db
              .update(schema.userTable)
              .set({ image: uploaded.url })
              .where(eq(schema.userTable.id, session.user.id));
          }),
        }).pipe(Effect.provideService(S3UploadService, s3Service));

        return uploaded;
      }).pipe(
        Effect.provide(AssetRepository.layer),
        withRemapDbErrors("UserProfile", "create")
      );
    })
).pipe(
  Layer.provide(HttpApiAuthMiddlewareLive),
  Layer.provide(UploadLimitsMiddlewareLive)
);

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
