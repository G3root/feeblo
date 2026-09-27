import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { S3Config } from "./s3-config";

const requiredS3Environment = {
  MEDIA_PUBLIC_BUCKET_NAME: "feeblo-media-public",
  MEDIA_UPLOAD_ENDPOINT: "http://127.0.0.1:9002",
  MEDIA_UPLOAD_REGION: "us-east-1",
};

const loadS3Config = (environment: Record<string, string | undefined> = {}) =>
  S3Config.pipe(
    Effect.provide(
      S3Config.layer.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              ...requiredS3Environment,
              ...environment,
            })
          )
        )
      )
    )
  );

describe("S3Config optional values", () => {
  // A blank value is what `VAR=` in a `.env` file and an empty Kubernetes value
  // both produce. Reading it as `Some("")` is not harmless: it made
  // `publicBaseUrl` a zero-length base and every media URL root-relative, and it
  // replaced the AWS default credential chain with empty upload keys.
  it.effect("treats a blank optional value as unset", () =>
    Effect.gen(function* () {
      const config = yield* loadS3Config({
        MEDIA_PUBLIC_BASE_URL: "",
        MEDIA_UPLOAD_ACCESS_KEY_ID: "",
        MEDIA_UPLOAD_SECRET_ACCESS_KEY: "",
      });

      expect(Option.isNone(config.publicBaseUrl)).toBe(true);
      expect(Option.isNone(config.accessKeyId)).toBe(true);
      expect(Option.isNone(config.secretAccessKey)).toBe(true);
    })
  );

  it.effect("treats a whitespace-only optional value as unset", () =>
    Effect.gen(function* () {
      const config = yield* loadS3Config({
        MEDIA_PUBLIC_BASE_URL: "   ",
      });

      expect(Option.isNone(config.publicBaseUrl)).toBe(true);
    })
  );

  it.effect("keeps a configured optional value", () =>
    Effect.gen(function* () {
      const config = yield* loadS3Config({
        MEDIA_PUBLIC_BASE_URL: "https://cdn.example.test",
        MEDIA_UPLOAD_ACCESS_KEY_ID: "feeblo",
        MEDIA_UPLOAD_SECRET_ACCESS_KEY: "password",
      });

      expect(Option.getOrNull(config.publicBaseUrl)).toBe(
        "https://cdn.example.test"
      );
      expect(Option.getOrNull(config.accessKeyId)).toBe("feeblo");
      expect(Option.getOrNull(config.secretAccessKey)).toBe("password");
    })
  );

  it.effect("leaves an absent optional value unset", () =>
    Effect.gen(function* () {
      const config = yield* loadS3Config();

      expect(Option.isNone(config.publicBaseUrl)).toBe(true);
      expect(Option.isNone(config.accessKeyId)).toBe(true);
      expect(Option.isNone(config.secretAccessKey)).toBe(true);
    })
  );
});
