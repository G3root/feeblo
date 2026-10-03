import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Multipart from "effect/http/Multipart";
import * as Schema from "effect/Schema";

import {
  UploadLimitError,
  UploadLimitsMiddleware,
} from "../http/upload-limits";
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
    HttpApiEndpoint.post("uploadOrganizationLogo", "/organization/logo", {
      success: OrganizationLogoUploadResponseSchema,
      error: Schema.Union([
        BadRequestError,
        UnauthorizedError,
        InternalServerError,
        UploadLimitError,
      ]),
      payload: Schema.Struct({
        organizationId: Schema.String,
        file: Multipart.SingleFileSchema,
      }).pipe(HttpApiSchema.asMultipart()),
    })
  )
  .middleware(HttpApiAuthMiddleware)
  .middleware(UploadLimitsMiddleware) {}
