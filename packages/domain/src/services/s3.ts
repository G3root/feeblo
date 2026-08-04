import { S3 } from "@effect-aws/client-s3";
import { S3FileSystem } from "@effect-aws/s3";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
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

export const isTemporaryEditorMediaKey = (key: string) =>
  key.startsWith(`${TEMPORARY_EDITOR_MEDIA_PREFIX}/`);

const makeS3UploadService = Effect.gen(function* () {
  const config = yield* S3Config;
  const bucket = config.publicBucketName;
  const fileSystem = yield* FileSystem.FileSystem;
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
        const fileKey = `${PROFILE_IMAGE_PREFIX}/${userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
        yield* fileSystem.writeFile(fileKey, bytes);
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
        const fileKey = `${ORGANIZATION_LOGO_PREFIX}/${organizationId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
        yield* fileSystem.writeFile(fileKey, bytes);
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
        const fileKey = `${TEMPORARY_EDITOR_MEDIA_PREFIX}/${userId}/${kind}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
        yield* fileSystem.writeFile(fileKey, bytes);
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

export const S3UploadServiceLive = Layer.unwrap(
  Effect.gen(function* () {
    const { publicBucketName } = yield* S3Config;
    const S3FileSystemLive = S3FileSystem.layer({
      bucketName: publicBucketName,
    }).pipe(Layer.provide(S3Layer));

    return S3UploadService.layer.pipe(
      Layer.provide(S3FileSystemLive),
      Layer.provide(S3Layer)
    );
  }).pipe(Effect.provide(S3Config.layer))
);
