import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { registerUploadedAsset } from "../asset/service";
import { Api } from "../http/api";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
  withRemapDbErrors,
} from "../rpc-errors";
import { S3UploadService, S3UploadServiceLive } from "../services/s3";
import {
  currentHttpApiSession,
  HttpApiAuthMiddlewareLive,
} from "../session-middleware";
import { MediaUploadLimitsMiddlewareLive } from "./api-contract";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPE_BY_KIND = {
  image: new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]),
} as const;

type MediaKind = keyof typeof CONTENT_TYPE_BY_KIND;

type SupportedContentType =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export const MediaApiLive = HttpApiBuilder.group(
  Api,
  "MediaApiGroup",
  (handlers) =>
    handlers.handle("uploadMedia", ({ payload: { file, organizationId } }) =>
      Effect.gen(function* () {
        const session = yield* currentHttpApiSession;

        const kind = getMediaKind(file.contentType);
        if (!kind) {
          return yield* new BadRequestError({
            message:
              "Unsupported file type. Use PNG/JPEG/WEBP/GIF",
          });
        }

        const extension = getFileExtension(file.contentType);
        if (!extension) {
          return yield* new BadRequestError({
            message:
              "Unsupported file type. Use PNG/JPEG/WEBP/GIF",
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
        const maxSize = FileSystem.Size(MAX_IMAGE_BYTES);
        if (fileInfo.size === FileSystem.Size(0) || fileInfo.size > maxSize) {
          const maxSizeMb = Math.round(Number(maxSize) / (1024 * 1024));
          return yield* new BadRequestError({
            message: `File must be between 1B and ${maxSizeMb}MB`,
          });
        }

        const bytes = yield* fs
          .readFile(file.path)
          .pipe(
            Effect.mapError(
              () => new InternalServerError({ message: "Failed to read file" })
            )
          );

        const sniffedContentType = sniffMediaType(bytes);
        if (
          sniffedContentType === null ||
          sniffedContentType !== file.contentType
        ) {
          return yield* new BadRequestError({
            message:
              "File content does not match its declared type. Use PNG/JPEG/WEBP/GIF",
          });
        }

        if (
          organizationId &&
          !session.organizations.some(({ id }) => id === organizationId)
        ) {
          return yield* new UnauthorizedError({
            message: "You are not a member of this organization",
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
          .uploadEditorMedia({
            bytes,
            extension,
            kind,
            userId: session.user.id,
          })
          .pipe(
            Effect.mapError(
              () =>
                new InternalServerError({ message: "Failed to upload media" })
            )
          );

        const registered = yield* registerUploadedAsset({
          owner: organizationId
            ? { type: "organization", id: organizationId }
            : { type: "user", id: session.user.id },
          kind: kind === "image" ? "editor_image" : "editor_video",
          uploaded,
        }).pipe(Effect.provideService(S3UploadService, s3Service));

        return { ...registered, kind };
      }).pipe(withRemapDbErrors("Media", "create"))
    )
).pipe(
  Layer.provide(HttpApiAuthMiddlewareLive),
  Layer.provide(MediaUploadLimitsMiddlewareLive)
);

function getMediaKind(contentType: string): MediaKind | null {
  if (CONTENT_TYPE_BY_KIND.image.has(contentType)) {
    return "image";
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
    default:
      return null;
  }
}

export function sniffMediaType(bytes: Uint8Array): SupportedContentType | null {
  if (isPng(bytes)) {
    return "image/png";
  }
  if (isJpeg(bytes)) {
    return "image/jpeg";
  }
  if (isGif(bytes)) {
    return "image/gif";
  }
  if (isWebp(bytes)) {
    return "image/webp";
  }
  return null;
}

function hasBytes(
  bytes: Uint8Array,
  offset: number,
  signature: readonly number[]
): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const isPng = (bytes: Uint8Array): boolean =>
  hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const isJpeg = (bytes: Uint8Array): boolean =>
  hasBytes(bytes, 0, [0xff, 0xd8, 0xff]);

const isGif = (bytes: Uint8Array): boolean =>
  hasBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
  hasBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

const isWebp = (bytes: Uint8Array): boolean =>
  hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
  hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
