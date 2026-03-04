import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
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
    handlers.handle("uploadProfilePicture", () => {
      return Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* CurrentSession;

        const source = request.source as
          | { formData?: () => Promise<{ get: (name: string) => unknown }> }
          | undefined;

        if (!source || typeof source.formData !== "function") {
          return yield* Effect.fail(
            new BadRequestError({ message: "Invalid upload payload" })
          );
        }

        const formData = yield* Effect.tryPromise({
          try: () =>
            source.formData() as Promise<{ get: (name: string) => unknown }>,
          catch: () =>
            new BadRequestError({ message: "Invalid upload payload" }),
        });

        const file = formData.get("file") as {
          size?: number;
          type?: string;
          arrayBuffer?: () => Promise<ArrayBuffer>;
        } | null;

        if (!file || typeof file.arrayBuffer !== "function") {
          return yield* Effect.fail(
            new BadRequestError({ message: "Missing profile image file" })
          );
        }

        const fileSize = typeof file.size === "number" ? file.size : 0;
        if (fileSize <= 0 || fileSize > MAX_PROFILE_IMAGE_BYTES) {
          return yield* Effect.fail(
            new BadRequestError({
              message: "Profile image must be between 1B and 5MB",
            })
          );
        }

        const fileType = typeof file.type === "string" ? file.type : "";
        if (!ALLOWED_CONTENT_TYPES.has(fileType)) {
          return yield* Effect.fail(
            new BadRequestError({
              message: "Unsupported file type. Use JPEG, PNG, or WEBP",
            })
          );
        }

        const extension = getFileExtension(fileType);
        if (!extension) {
          return yield* Effect.fail(
            new BadRequestError({
              message: "Unsupported file type. Use JPEG, PNG, or WEBP",
            })
          );
        }

        const bytes = yield* Effect.tryPromise({
          try: async () =>
            new Uint8Array((await file.arrayBuffer?.()) ?? new ArrayBuffer(0)),
          catch: () =>
            new InternalServerError({ message: "Failed to read file" }),
        });

        const s3Service = yield* S3UploadService;
        const uploaded = yield* s3Service.uploadProfileImage({
          bytes,
          extension,
          userId: session.user.id,
        });

        const db = yield* DB;

        yield* db
          .update(userTable)
          .set({
            image: uploaded.url,
          })
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
