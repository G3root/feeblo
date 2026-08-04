import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Multipart from "effect/unstable/http/Multipart";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { HttpApiAuthMiddleware } from "../session-middleware";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FIELD_BYTES = 1 * 1024 * 1024;

/**
 * Enforces multipart parsing limits (file/total size, part count) while the
 * request is being streamed to disk, before the handler ever reads it.
 */
export class MediaUploadLimitsMiddleware extends HttpApiMiddleware.Service<MediaUploadLimitsMiddleware>()(
  "api/MediaUploadLimitsMiddleware",
  {}
) {}

export const MediaUploadLimitsMiddlewareLive = Layer.succeed(
  MediaUploadLimitsMiddleware,
  MediaUploadLimitsMiddleware.of((effect) =>
    Effect.provide(
      effect,
      Multipart.limitsServices({
        maxFileSize: MAX_IMAGE_BYTES,
        maxParts: 20,
        maxFieldSize: MAX_FIELD_BYTES,
        maxTotalSize: MAX_IMAGE_BYTES + MAX_FIELD_BYTES,
      })
    )
  )
);

export const MediaUploadResponseSchema = Schema.Struct({
  assetId: Schema.String,
  bucket: Schema.String,
  key: Schema.String,
  kind: Schema.Literal("image"),
  url: Schema.String,
});

export class MediaApiGroup extends HttpApiGroup.make("MediaApiGroup")
  .add(
    HttpApiEndpoint.post("uploadMedia", "/media/upload", {
      success: MediaUploadResponseSchema,
      error: Schema.Union([
        BadRequestError,
        UnauthorizedError,
        InternalServerError,
      ]),
      payload: Schema.Struct({
        file: Multipart.SingleFileSchema,
        organizationId: Schema.optional(Schema.String),
      }).pipe(HttpApiSchema.asMultipart()),
    })
      .annotate(OpenApi.Title, "Upload Editor Media")
      .annotate(
        OpenApi.Description,
        "Uploads editor media for the authenticated user and returns the public URL"
      )
      .annotate(OpenApi.Summary, "Upload editor media")
  )
  .middleware(HttpApiAuthMiddleware)
  .middleware(MediaUploadLimitsMiddleware) {}
