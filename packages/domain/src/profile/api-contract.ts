import * as Schema from "effect/Schema";

import * as Multipart from "effect/unstable/http/Multipart";

import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

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
  .middleware(HttpApiAuthMiddleware) {}
