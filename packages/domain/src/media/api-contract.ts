import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  Multipart,
  OpenApi,
} from "@effect/platform";
import { Schema } from "effect";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { HttpApiAuthMiddleware } from "../session-middleware";

export const MediaUploadResponseSchema = Schema.Struct({
  bucket: Schema.String,
  key: Schema.String,
  kind: Schema.Literal("image", "video"),
  url: Schema.String,
});

export class MediaApiGroup extends HttpApiGroup.make("MediaApiGroup")
  .add(
    HttpApiEndpoint.post("uploadMedia", "/media/upload")
      .addSuccess(MediaUploadResponseSchema, { status: 200 })
      .addError(BadRequestError)
      .addError(UnauthorizedError)
      .addError(InternalServerError)
      .setPayload(
        HttpApiSchema.Multipart(
          Schema.Struct({
            file: Multipart.SingleFileSchema,
          })
        )
      )
      .annotateContext(
        OpenApi.annotations({
          title: "Upload Editor Media",
          description:
            "Uploads editor media for the authenticated user and returns the public URL",
          summary: "Upload editor media",
        })
      )
  )
  .middleware(HttpApiAuthMiddleware) {}
