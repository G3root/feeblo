import { S3 } from "@effect-aws/client-s3";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { S3Config } from "./s3-config";

export const S3Layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* S3Config;

    const credentials =
      config.accessKeyId._tag === "Some" &&
      config.secretAccessKey._tag === "Some"
        ? {
            accessKeyId: config.accessKeyId.value,
            secretAccessKey: config.secretAccessKey.value,
          }
        : undefined;

    return S3.layer({
      region: config.region,
      endpoint: config.endpoint,
      ...(credentials ? { credentials } : {}),
    });
  }).pipe(Effect.provide(S3Config.layer))
);

const TRAILING_SLASH_REGEX = /\/$/;
const PROFILE_IMAGE_PREFIX = "profile-images";
const ORGANIZATION_LOGO_PREFIX = "organization-logos";
const EDITOR_MEDIA_PREFIX = "editor-media";
export const TEMPORARY_EDITOR_MEDIA_PREFIX = `tmp/${EDITOR_MEDIA_PREFIX}`;

// Every object key embeds a timestamp and UUID, so the content at any given
// URL never changes. Cache forever: immutable responses are never revalidated
// while fresh, so replacing an avatar/logo just writes a new URL to the
// database and abandons the old one. No SWR tags or cache purging needed.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const contentTypeForExtension = (extension: string): string =>
  CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";

export const isTemporaryEditorMediaKey = (key: string) =>
  key.startsWith(`${TEMPORARY_EDITOR_MEDIA_PREFIX}/`);

const makeS3UploadService = Effect.gen(function* () {
  const config = yield* S3Config;
  const bucket = config.publicBucketName;
  const s3 = yield* S3;
  const resolvePublicUrl = (fileKey: string) => {
    const encodedKey = fileKey
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const baseUrl =
      config.publicBaseUrl._tag === "Some"
        ? config.publicBaseUrl.value.replace(TRAILING_SLASH_REGEX, "")
        : `${config.endpoint.replace(TRAILING_SLASH_REGEX, "")}/${bucket}`;

    return {
      bucket,
      key: fileKey,
      url: `${baseUrl}/${encodedKey}`,
    };
  };

  return {
    uploadProfileImage: ({
      bytes,
      extension,
      userId,
    }: {
      bytes: Uint8Array;
      extension: string;
      userId: string;
    }) =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const now = yield* DateTime.now;
        const fileKey = `${PROFILE_IMAGE_PREFIX}/${userId}/${now.epochMilliseconds}-${yield* crypto.randomUUIDv4}.${extension}`;
        yield* s3.putObject({
          Bucket: bucket,
          Key: fileKey,
          Body: bytes,
          ContentType: contentTypeForExtension(extension),
          CacheControl: IMMUTABLE_CACHE_CONTROL,
        });
        return resolvePublicUrl(fileKey);
      }),
    uploadOrganizationLogo: ({
      bytes,
      extension,
      organizationId,
    }: {
      bytes: Uint8Array;
      extension: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const now = yield* DateTime.now;
        const fileKey = `${ORGANIZATION_LOGO_PREFIX}/${organizationId}/${now.epochMilliseconds}-${yield* crypto.randomUUIDv4}.${extension}`;
        yield* s3.putObject({
          Bucket: bucket,
          Key: fileKey,
          Body: bytes,
          ContentType: contentTypeForExtension(extension),
          CacheControl: IMMUTABLE_CACHE_CONTROL,
        });
        return resolvePublicUrl(fileKey);
      }),
    uploadEditorMedia: ({
      bytes,
      extension,
      kind,
      userId,
    }: {
      bytes: Uint8Array;
      extension: string;
      kind: "image";
      userId: string;
    }) =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const now = yield* DateTime.now;
        const fileKey = `${TEMPORARY_EDITOR_MEDIA_PREFIX}/${userId}/${kind}/${now.epochMilliseconds}-${yield* crypto.randomUUIDv4}.${extension}`;
        yield* s3.putObject({
          Bucket: bucket,
          Key: fileKey,
          Body: bytes,
          ContentType: contentTypeForExtension(extension),
          CacheControl: IMMUTABLE_CACHE_CONTROL,
        });
        return resolvePublicUrl(fileKey);
      }),
    promoteEditorMedia: ({
      bucket: sourceBucket,
      key: sourceKey,
    }: { bucket: string; key: string }) =>
      Effect.gen(function* () {
        const finalKey = sourceKey.slice(
          `${TEMPORARY_EDITOR_MEDIA_PREFIX}/`.length
        );
        yield* s3.copyObject({
          Bucket: sourceBucket,
          CopySource: `${encodeURIComponent(sourceBucket)}/${encodeURIComponent(sourceKey)}`,
          Key: finalKey,
        });
        return resolvePublicUrl(finalKey);
      }),
    deleteObject: (bucket: string, key: string) =>
      s3.deleteObject({ Bucket: bucket, Key: key }),
  };
});

export class S3UploadService extends Context.Service<S3UploadService>()(
  "S3UploadService",
  {
    make: makeS3UploadService.pipe(Effect.provide(S3Config.layer)),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

export const S3UploadServiceLive = S3UploadService.layer.pipe(
  Layer.provide(S3Layer)
);
