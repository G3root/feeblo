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
      ...(credentials && { credentials }),
    });
  })
).pipe(Layer.provide(S3Config.layer));

const TRAILING_SLASH_REGEX = /\/$/;
const PROFILE_IMAGE_PREFIX = "profile-images";
const ORGANIZATION_LOGO_PREFIX = "organization-logos";
const EDITOR_MEDIA_PREFIX = "editor-media";
export const TEMPORARY_EDITOR_MEDIA_PREFIX = `tmp/${EDITOR_MEDIA_PREFIX}`;

export const isTemporaryEditorMediaKey = (key: string) =>
  key.startsWith(`${TEMPORARY_EDITOR_MEDIA_PREFIX}/`);

/**
 * `Cache-Control` for objects written to a permanent key. Keys carry a
 * timestamp and a UUID, so the object behind one is never rewritten — but it
 * can still be deleted (a replaced logo, an orphaned editor asset) while a
 * CDN copy stays reachable at its URL, which is why this is a day rather than
 * a year.
 */
const PUBLIC_OBJECT_CACHE_CONTROL = "public, max-age=86400";

/**
 * `Cache-Control` for `tmp/editor-media/` objects. These are the only objects
 * written here that are expected to disappear: the bucket lifecycle rule reaps
 * abandoned uploads. The short TTL bounds how long a deleted upload stays
 * readable from a CDN that already served it.
 */
const TEMPORARY_OBJECT_CACHE_CONTROL = "public, max-age=3600";

/**
 * `Cache-Control` written with the object at `key`. Objects under
 * `tmp/editor-media/` are the only ones a lifecycle rule deletes, so they are
 * the only ones served with a TTL short enough to keep that deletion
 * meaningful.
 */
export const objectCacheControl = (key: string) =>
  isTemporaryEditorMediaKey(key)
    ? TEMPORARY_OBJECT_CACHE_CONTROL
    : PUBLIC_OBJECT_CACHE_CONTROL;

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
  // Written through `S3.putObject` rather than the `@effect-aws/s3` file
  // system: `writeFile` sends only `Bucket`, `Key`, and `Body`, and object
  // storage does not infer a content type from the key's extension, so every
  // object would be served as `application/octet-stream`.
  const putObject = ({
    bytes,
    contentType,
    fileKey,
  }: {
    bytes: Uint8Array;
    contentType: string;
    fileKey: string;
  }) =>
    s3.putObject({
      Body: bytes,
      Bucket: bucket,
      CacheControl: objectCacheControl(fileKey),
      ContentType: contentType,
      Key: fileKey,
    });

  return {
    uploadProfileImage: ({
      bytes,
      contentType,
      extension,
      userId,
    }: {
      bytes: Uint8Array;
      contentType: string;
      extension: string;
      userId: string;
    }) =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const now = yield* DateTime.now;
        const fileKey = `${PROFILE_IMAGE_PREFIX}/${userId}/${now.epochMilliseconds}-${yield* crypto.randomUUIDv4}.${extension}`;
        yield* putObject({ bytes, contentType, fileKey });
        return resolvePublicUrl(fileKey);
      }),
    uploadOrganizationLogo: ({
      bytes,
      contentType,
      extension,
      organizationId,
    }: {
      bytes: Uint8Array;
      contentType: string;
      extension: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const now = yield* DateTime.now;
        const fileKey = `${ORGANIZATION_LOGO_PREFIX}/${organizationId}/${now.epochMilliseconds}-${yield* crypto.randomUUIDv4}.${extension}`;
        yield* putObject({ bytes, contentType, fileKey });
        return resolvePublicUrl(fileKey);
      }),
    uploadEditorMedia: ({
      bytes,
      contentType,
      extension,
      kind,
      userId,
    }: {
      bytes: Uint8Array;
      contentType: string;
      extension: string;
      kind: "image";
      userId: string;
    }) =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const now = yield* DateTime.now;
        const fileKey = `${TEMPORARY_EDITOR_MEDIA_PREFIX}/${userId}/${kind}/${now.epochMilliseconds}-${yield* crypto.randomUUIDv4}.${extension}`;
        yield* putObject({ bytes, contentType, fileKey });
        return resolvePublicUrl(fileKey);
      }),
    promoteEditorMedia: ({
      bucket: sourceBucket,
      key: sourceKey,
    }: {
      bucket: string;
      key: string;
    }) =>
      Effect.gen(function* () {
        const finalKey = sourceKey.slice(
          `${TEMPORARY_EDITOR_MEDIA_PREFIX}/`.length
        );
        // `copyObject` keeps the source's metadata (S3's default
        // `MetadataDirective: COPY`), so the promoted object inherits both the
        // content type and the temporary cache TTL the upload wrote. Giving it
        // the permanent TTL instead would need `MetadataDirective: REPLACE`,
        // which is not worth a dependency on copy semantics this deployment
        // cannot verify.
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
    make: makeS3UploadService,
  }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(S3Config.layer)
  );
}

export const S3UploadServiceLive = S3UploadService.layer.pipe(
  Layer.provide(S3Layer)
);
