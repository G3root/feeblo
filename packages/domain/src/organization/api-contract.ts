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

export const OrganizationLogoUploadResponseSchema = Schema.Struct({
  bucket: Schema.String,
  key: Schema.String,
  url: Schema.String,
});

export class OrganizationApiGroup extends HttpApiGroup.make(
  "OrganizationApiGroup"
)
  .add(
    HttpApiEndpoint.post("uploadOrganizationLogo", "/organization/logo")
      .addSuccess(OrganizationLogoUploadResponseSchema, { status: 200 })
      .addError(BadRequestError)
      .addError(UnauthorizedError)
      .addError(InternalServerError)
      .setPayload(
        HttpApiSchema.Multipart(
          Schema.Struct({
            organizationId: Schema.String,
            file: Multipart.SingleFileSchema,
          })
        )
      )
      .annotateContext(
        OpenApi.annotations({
          title: "Upload Organization Logo",
          description:
            "Uploads an organization logo for an owner or admin and stores bucket/key metadata",
          summary: "Upload organization logo",
        })
      )
  )
  .middleware(HttpApiAuthMiddleware) {}
