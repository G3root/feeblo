import { FileSystem, HttpApiBuilder } from "@effect/platform";
import { DB } from "@feeblo/db";
import { user as userTable } from "@feeblo/db/schema/auth";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Api } from "../http/api";
import {
  BadRequestError,
  InternalServerError,
  mapToInternalServerError,
} from "../rpc-errors";
import { S3UploadService } from "../services/s3";
import { CurrentSession } from "../session-middleware";

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
        const session = yield* CurrentSession;

        if (!ALLOWED_CONTENT_TYPES.has(file.contentType)) {
          return yield* Effect.fail(
            new BadRequestError({
              message: "Unsupported file type. Use JPEG, PNG, or WEBP",
            })
          );
        }

        const extension = getFileExtension(file.contentType);
        if (!extension) {
          return yield* Effect.fail(
            new BadRequestError({
              message: "Unsupported file type. Use JPEG, PNG, or WEBP",
            })
          );
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
          return yield* Effect.fail(
            new BadRequestError({
              message: "Profile image must be between 1B and 5MB",
            })
          );
        }

        const s3Service = yield* S3UploadService;
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

        const db = yield* DB;

        yield* db
          .update(userTable)
          .set({ image: uploaded.url })
          .where(eq(userTable.id, session.user.id))
          .pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Failed to save profile image",
                })
            )
          );

        return uploaded;
      }).pipe(
        Effect.mapError(
          mapToInternalServerError(BadRequestError, InternalServerError)
        )
      );
    })
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
