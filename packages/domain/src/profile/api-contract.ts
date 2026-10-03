import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Multipart from "effect/http/Multipart";
import * as Schema from "effect/Schema";

import { UploadLimitsMiddleware } from "../http/upload-limits";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { HttpApiAuthMiddleware } from "../session-middleware";

export const ProfilePictureUploadResponseSchema = Schema.Struct({
  bucket: Schema.String,
  key: Schema.String,
  url: Schema.String,
});

export class ProfileApiGroup extends HttpApiGroup.make("ProfileApiGroup")
  .add(
    HttpApiEndpoint.post("uploadProfilePicture", "/profile/picture", {
      success: ProfilePictureUploadResponseSchema,
      error: Schema.Union([
        BadRequestError,
        UnauthorizedError,
        InternalServerError,
      ]),
      payload: Schema.Struct({
        file: Multipart.SingleFileSchema,
      }).pipe(HttpApiSchema.asMultipart()),
    })
  )
  .middleware(HttpApiAuthMiddleware)
  .middleware(UploadLimitsMiddleware) {}
