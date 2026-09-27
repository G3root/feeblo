import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

/**
 * An optional string in which a blank value means unset.
 *
 * `Config.string(name).pipe(Config.option)` answers `Some("")` for a variable
 * that is present but empty, which is what `VAR=` in a `.env` file and an empty
 * Kubernetes value both produce. Every consumer below reads `Some` as "the
 * operator configured this", so a blank value has to answer `None`:
 * `Some("")` for `publicBaseUrl` turned every uploaded media URL into a
 * root-relative path, and `Some("")` for both upload credentials replaced the
 * AWS default credential chain with empty keys. This mirrors the `optionalString`
 * helper in `@feeblo/config`, which is a devDependency here and so cannot be
 * imported from package source.
 */
const optionalNonEmptyString = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Effect.map((value) =>
      Option.isSome(value) && value.value.trim() !== "" ? value : Option.none()
    )
  );

export class S3Config extends Context.Service<S3Config>()("S3Config", {
  make: Effect.gen(function* () {
    const region = yield* Config.string("MEDIA_UPLOAD_REGION");
    const endpoint = yield* Config.string("MEDIA_UPLOAD_ENDPOINT");
    const accessKeyId = yield* optionalNonEmptyString(
      "MEDIA_UPLOAD_ACCESS_KEY_ID"
    );
    const secretAccessKey = yield* optionalNonEmptyString(
      "MEDIA_UPLOAD_SECRET_ACCESS_KEY"
    );
    const publicBucketName = yield* Config.string("MEDIA_PUBLIC_BUCKET_NAME");
    const publicBaseUrl = yield* optionalNonEmptyString(
      "MEDIA_PUBLIC_BASE_URL"
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
  static readonly layer = Layer.effect(this, this.make);
}
