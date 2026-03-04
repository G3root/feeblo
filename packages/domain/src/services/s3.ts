import { FileSystem } from "@effect/platform";
import { S3 } from "@effect-aws/client-s3";
import { S3FileSystem } from "@effect-aws/s3";
import { Config, Effect, Layer } from "effect";

/**
 * Configuration for S3 service
 */
const S3ConfigSchema = Effect.all({
  region: Config.string("MEDIA_UPLOAD_REGION"),
  endpoint: Config.string("MEDIA_UPLOAD_ENDPOINT"),
  accessKeyId: Config.string("MEDIA_UPLOAD_ACCESS_KEY_ID").pipe(Config.option),
  secretAccessKey: Config.string("MEDIA_UPLOAD_SECRET_ACCESS_KEY").pipe(
    Config.option
  ),
  publicBucketName: Config.string("MEDIA_PUBLIC_BUCKET_NAME"),
  publicBaseUrl: Config.string("MEDIA_PUBLIC_BASE_URL").pipe(Config.option),
});

/**
 * Layer that provides S3Service with custom configuration
 */
export const S3Layer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* S3ConfigSchema;

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
      credentials,
    });
  })
);

const PROFILE_IMAGE_PREFIX = "profile-images";

export class S3UploadService extends Effect.Service<S3UploadService>()(
  "S3UploadService",
  {
    effect: Effect.gen(function* () {
      const config = yield* S3ConfigSchema;
      const bucket = config.publicBucketName;
      const fileSystem = yield* FileSystem.FileSystem;

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

            const encodedKey = fileKey
              .split("/")
              .map((segment) => encodeURIComponent(segment))
              .join("/");
            const baseUrl =
              config.publicBaseUrl._tag === "Some"
                ? config.publicBaseUrl.value.replace(/\/$/, "")
                : `${config.endpoint.replace(/\/$/, "")}/${bucket}`;

            return {
              bucket,
              key: fileKey,
              url: `${baseUrl}/${encodedKey}`,
            };
          }),
      };
    }),
  }
) {}

export const S3UploadServiceLive = Layer.unwrapEffect(
  Config.string("MEDIA_PUBLIC_BUCKET_NAME").pipe(
    Effect.map((bucketName) => {
      const S3FileSystemLive = S3FileSystem.layer({ bucketName }).pipe(
        Layer.provide(S3Layer)
      );

      return S3UploadService.Default.pipe(Layer.provideMerge(S3FileSystemLive));
    })
  )
);
