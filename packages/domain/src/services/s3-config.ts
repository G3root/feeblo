import { Config, Effect } from "effect";

export class S3Config extends Effect.Service<S3Config>()("S3Config", {
  effect: Effect.gen(function* () {
    const region = yield* Config.string("MEDIA_UPLOAD_REGION");
    const endpoint = yield* Config.string("MEDIA_UPLOAD_ENDPOINT");
    const accessKeyId = yield* Config.string("MEDIA_UPLOAD_ACCESS_KEY_ID").pipe(
      Config.option
    );
    const secretAccessKey = yield* Config.string(
      "MEDIA_UPLOAD_SECRET_ACCESS_KEY"
    ).pipe(Config.option);
    const publicBucketName = yield* Config.string("MEDIA_PUBLIC_BUCKET_NAME");
    const publicBaseUrl = yield* Config.string("MEDIA_PUBLIC_BASE_URL").pipe(
      Config.option
    );

    return {
      accessKeyId,
      endpoint,
      publicBaseUrl,
      publicBucketName,
      region,
      secretAccessKey,
    } as const;
  }),
}) {
  static readonly layer = this.Default;
}
