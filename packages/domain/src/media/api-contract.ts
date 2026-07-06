import * as Schema from "effect/Schema";

import * as Multipart from "effect/unstable/http/Multipart";

import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { HttpApiAuthMiddleware } from "../session-middleware";

export const MediaUploadResponseSchema = Schema.Struct({
  bucket: Schema.String,
  key: Schema.String,
  kind: Schema.Literals(["image", "video"]),
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
      }).pipe(HttpApiSchema.asMultipart()),
    })
      .annotate(OpenApi.Title, "Upload Editor Media")
      .annotate(
        OpenApi.Description,
        "Uploads editor media for the authenticated user and returns the public URL"
      )
      .annotate(OpenApi.Summary, "Upload editor media")
  )
  .middleware(HttpApiAuthMiddleware) {}
