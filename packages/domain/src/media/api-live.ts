import { FileSystem, HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../http/api";
import {
  BadRequestError,
  InternalServerError,
  mapToInternalServerError,
} from "../rpc-errors";
import { S3UploadService } from "../services/s3";
import { CurrentSession } from "../session-middleware";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const CONTENT_TYPE_BY_KIND = {
  image: new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]),
  video: new Set(["video/mp4", "video/quicktime", "video/webm"]),
} as const;

type MediaKind = keyof typeof CONTENT_TYPE_BY_KIND;

export const MediaApiLive = HttpApiBuilder.group(Api, "MediaApiGroup", (handlers) =>
  handlers.handle("uploadMedia", ({ payload: { file } }) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;

      const kind = getMediaKind(file.contentType);
      if (!kind) {
        return yield* Effect.fail(
          new BadRequestError({
            message:
              "Unsupported file type. Use PNG/JPEG/WEBP/GIF or MP4/WebM/MOV",
          })
        );
      }

      const extension = getFileExtension(file.contentType);
      if (!extension) {
        return yield* Effect.fail(
          new BadRequestError({
            message:
              "Unsupported file type. Use PNG/JPEG/WEBP/GIF or MP4/WebM/MOV",
          })
        );
      }

      const fs = yield* FileSystem.FileSystem;
      const bytes = yield* fs.readFile(file.path).pipe(
        Effect.mapError(
          () => new InternalServerError({ message: "Failed to read file" })
        )
      );

      const maxSize = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
      if (bytes.length === 0 || bytes.length > maxSize) {
        const maxSizeMb = Math.round(maxSize / (1024 * 1024));
        return yield* Effect.fail(
          new BadRequestError({
            message: `File must be between 1B and ${maxSizeMb}MB`,
          })
        );
      }

      const s3Service = yield* S3UploadService;
      const uploaded = yield* s3Service
        .uploadEditorMedia({
          bytes,
          extension,
          kind,
          userId: session.user.id,
        })
        .pipe(
          Effect.mapError(
            () => new InternalServerError({ message: "Failed to upload media" })
          )
        );

      return { ...uploaded, kind };
    }).pipe(
      Effect.mapError(
        mapToInternalServerError(BadRequestError, InternalServerError)
      )
    )
  )
);

function getMediaKind(contentType: string): MediaKind | null {
  if (CONTENT_TYPE_BY_KIND.image.has(contentType)) {
    return "image";
  }
  if (CONTENT_TYPE_BY_KIND.video.has(contentType)) {
    return "video";
  }
  return null;
}

function getFileExtension(contentType: string): string | null {
  switch (contentType) {
    case "image/gif":
      return "gif";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    default:
      return null;
  }
}
