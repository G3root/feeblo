import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";
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
    HttpApiEndpoint.post("uploadProfilePicture", "/profile/picture")
      .addSuccess(ProfilePictureUploadResponseSchema, { status: 200 })
      .addError(BadRequestError)
      .addError(UnauthorizedError)
      .addError(InternalServerError)
      .annotateContext(
        OpenApi.annotations({
          title: "Upload Profile Picture",
          description:
            "Uploads the authenticated user's profile picture and stores bucket/key metadata",
          summary: "Upload profile picture",
        })
      )
  )
  .middleware(HttpApiAuthMiddleware) {}
