import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

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
import { MediaUploadLimitsMiddlewareLive } from "./api-contract";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const CONTENT_TYPE_BY_KIND = {
  image: new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]),
  video: new Set(["video/mp4", "video/quicktime", "video/webm"]),
} as const;

type MediaKind = keyof typeof CONTENT_TYPE_BY_KIND;

type SupportedContentType =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "video/quicktime"
  | "video/webm";

export const MediaApiLive = HttpApiBuilder.group(
  Api,
  "MediaApiGroup",
  (handlers) =>
    handlers.handle("uploadMedia", ({ payload: { file } }) =>
      Effect.gen(function* () {
        const session = yield* currentHttpApiSession;

        const kind = getMediaKind(file.contentType);
        if (!kind) {
          return yield* new BadRequestError({
            message:
              "Unsupported file type. Use PNG/JPEG/WEBP/GIF or MP4/WebM/MOV",
          });
        }

        const extension = getFileExtension(file.contentType);
        if (!extension) {
          return yield* new BadRequestError({
            message:
              "Unsupported file type. Use PNG/JPEG/WEBP/GIF or MP4/WebM/MOV",
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
        const maxSize = FileSystem.Size(
          kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
        );
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
              "File content does not match its declared type. Use PNG/JPEG/WEBP/GIF or MP4/WebM/MOV",
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

        return { ...uploaded, kind };
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
  if (isMp4(bytes)) {
    return "video/mp4";
  }
  if (isMov(bytes)) {
    return "video/quicktime";
  }
  if (isWebm(bytes)) {
    return "video/webm";
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

const isFtyp = (bytes: Uint8Array): boolean =>
  bytes.length >= 16 && hasBytes(bytes, 4, [0x66, 0x74, 0x79, 0x70]);

const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso7",
  "iso8",
  "iso9",
  "isoM",
  "mp41",
  "mp42",
  "mp4v",
  "mp71",
  "mp72",
  "avc1",
  "avc2",
  "avc3",
  "avc4",
  "hvc1",
  "hev1",
  "av01",
  "dash",
  "cmfc",
  "cmff",
  "M4V ",
]);

const readFourCc = (bytes: Uint8Array, offset: number): string | null => {
  if (bytes.length < offset + 4) {
    return null;
  }
  return String.fromCharCode(...bytes.slice(offset, offset + 4));
};

const readUint32 = (bytes: Uint8Array, offset: number): number | null => {
  if (bytes.length < offset + 4) {
    return null;
  }
  return (
    bytes[offset]! * 0x1_00_00_00 +
    bytes[offset + 1]! * 0x1_00_00 +
    bytes[offset + 2]! * 0x1_00 +
    bytes[offset + 3]!
  );
};

const isMp4 = (bytes: Uint8Array): boolean => {
  if (!isFtyp(bytes)) {
    return false;
  }

  const boxSize = readUint32(bytes, 0);
  if (boxSize === null || (boxSize !== 0 && boxSize < 16)) {
    return false;
  }

  const boxEnd = boxSize === 0 ? bytes.length : Math.min(boxSize, bytes.length);
  const brands = [readFourCc(bytes, 8)];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brands.push(readFourCc(bytes, offset));
  }

  return brands.some((brand) => brand !== null && MP4_BRANDS.has(brand));
};

const isMov = (bytes: Uint8Array): boolean =>
  isFtyp(bytes) && readFourCc(bytes, 8) === "qt  ";

const readEbmlVarint = (
  bytes: Uint8Array,
  offset: number
): { value: number; length: number } | null => {
  if (offset >= bytes.length) {
    return null;
  }
  const first = bytes[offset];
  if (first === undefined) {
    return null;
  }

  let length = 1;
  if (first < 0x02) {
    length = 8;
  } else if (first < 0x04) {
    length = 7;
  } else if (first < 0x08) {
    length = 6;
  } else if (first < 0x10) {
    length = 5;
  } else if (first < 0x20) {
    length = 4;
  } else if (first < 0x40) {
    length = 3;
  } else if (first < 0x80) {
    length = 2;
  }

  if (offset + length > bytes.length) {
    return null;
  }

  let value = first % 2 ** (8 - length);
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) {
      return null;
    }
    value = value * 0x1_00 + byte;
  }
  return { value, length };
};

const isWebm = (bytes: Uint8Array): boolean => {
  if (!hasBytes(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return false;
  }

  const headerSize = readEbmlVarint(bytes, 4);
  if (headerSize === null) {
    return false;
  }

  const headerStart = 4 + headerSize.length;
  const headerEnd = headerStart + headerSize.value;
  if (headerEnd > bytes.length) {
    return false;
  }

  let offset = headerStart;
  while (offset < headerEnd) {
    const id = readEbmlVarint(bytes, offset);
    if (id === null) {
      return false;
    }

    const idOffset = offset;
    offset += id.length;

    const size = readEbmlVarint(bytes, offset);
    if (size === null) {
      return false;
    }
    offset += size.length;

    if (hasBytes(bytes, idOffset, [0x42, 0x82])) {
      // DocType element
      return (
        size.value === 4 && hasBytes(bytes, offset, [0x77, 0x65, 0x62, 0x6d]) // "webm"
      );
    }

    offset += size.value;
  }

  return false;
};
