import {
  makeS3Service,
  S3ClientInstance as S3ClientInstanceNS,
  S3Service,
  S3ServiceConfig,
} from "@effect-aws/client-s3";
import { make as makeS3ClientInstance } from "@effect-aws/client-s3/S3ClientInstance";
import { Config, Effect, Layer } from "effect";
import type { ConfigError } from "effect/ConfigError";

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
});

/**
 * Custom S3ServiceConfig layer with configuration from environment
 */
const S3ServiceConfigLayer = Layer.unwrapEffect(
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

    return S3ServiceConfig.setS3ServiceConfig({
      region: config.region,
      endpoint: config.endpoint,
      credentials,
    });
  })
);

/**
 * Custom S3ClientInstance layer using makeS3ClientInstance
 */
const S3ClientInstanceLayer = Layer.scoped(
  S3ClientInstanceNS.S3ClientInstance,
  makeS3ClientInstance
).pipe(Layer.provide(S3ServiceConfigLayer));

/**
 * Layer that provides S3Service with custom configuration
 */
export const S3Layer: Layer.Layer<S3Service, ConfigError, never> = Layer.effect(
  S3Service,
  makeS3Service
).pipe(Layer.provide(S3ClientInstanceLayer));
