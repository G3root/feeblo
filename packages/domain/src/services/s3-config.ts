import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
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

/**
 * S3 takes both halves of a credential pair or neither.
 *
 * `S3Layer` builds explicit credentials only when both are present and otherwise
 * leaves the client to the AWS default credential chain. A half-configured pair
 * therefore does not fail — it silently authenticates as whatever the
 * environment provides, or as nothing at all — so the mismatch is caught here,
 * where the error channel is already `ConfigError` and startup stops with a
 * message naming both variables.
 */
const validateCredentialPair = (input: {
  readonly accessKeyId: Option.Option<string>;
  readonly secretAccessKey: Option.Option<string>;
}) =>
  Option.isSome(input.accessKeyId) === Option.isSome(input.secretAccessKey)
    ? Effect.void
    : Effect.fail(
        new Config.ConfigError(
          new ConfigProvider.SourceError({
            message:
              "MEDIA_UPLOAD_ACCESS_KEY_ID and MEDIA_UPLOAD_SECRET_ACCESS_KEY must be set together or left blank together: with only one set, S3 falls back to the default credential chain instead of using it",
          })
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
    yield* validateCredentialPair({ accessKeyId, secretAccessKey });
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
