import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Multipart from "effect/http/Multipart";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { RateLimitErrors } from "../rate-limit";
import { HttpApiAuthMiddleware } from "../session-middleware";
import { DataTransferServiceErrors } from "./errors";
import { DATA_IMPORT_MAX_BYTES } from "./limits";
import {
  BoardExportQuery,
  BoardImportUploadFields,
  DataImportJobSummary,
} from "./schema";

const MAX_IMPORT_FIELD_BYTES = 16 * 1024;

/**
 * Enforces the upload's size limits while the multipart body is streamed to
 * disk, before the handler reads a byte — the same guard the media upload
 * uses, sized for a CSV.
 */
export class DataImportUploadLimitsMiddleware extends HttpApiMiddleware.Service<DataImportUploadLimitsMiddleware>()(
  "api/DataImportUploadLimitsMiddleware",
  {}
) {}

export const DataImportUploadLimitsMiddlewareLive = Layer.succeed(
  DataImportUploadLimitsMiddleware,
  DataImportUploadLimitsMiddleware.of((effect) =>
    Effect.provide(
      effect,
      Multipart.limitsServices({
        maxFieldSize: MAX_IMPORT_FIELD_BYTES,
        maxFileSize: DATA_IMPORT_MAX_BYTES,
        maxParts: 5,
        maxTotalSize: DATA_IMPORT_MAX_BYTES + MAX_IMPORT_FIELD_BYTES,
      })
    )
  )
);

/**
 * The two file endpoints of the transfer feature.
 *
 * The bytes never touch RPC: an upload arrives as multipart and an export
 * leaves as a streamed `text/csv` response, because both are files and the
 * dashboard HTTP API already owns exactly that shape. The success type of the
 * export is a stream so the OpenAPI document and the generated client describe
 * the body honestly; the handler returns a raw response anyway, to set the
 * download's filename.
 */
export class DataTransferApiGroup extends HttpApiGroup.make(
  "DataTransferApiGroup"
)
  .add(
    HttpApiEndpoint.post("uploadBoardImport", "/data/import", {
      error: Schema.Union([DataTransferServiceErrors, RateLimitErrors]),
      payload: Schema.Struct({
        file: Multipart.SingleFileSchema,
        ...BoardImportUploadFields,
      }).pipe(HttpApiSchema.asMultipart()),
      success: DataImportJobSummary,
    }),
    HttpApiEndpoint.get("exportBoardPosts", "/data/export", {
      error: Schema.Union([DataTransferServiceErrors, RateLimitErrors]),
      query: BoardExportQuery,
      success: HttpApiSchema.StreamUint8Array({
        contentType: "text/csv; charset=utf-8",
      }),
    })
  )
  .middleware(HttpApiAuthMiddleware)
  .middleware(DataImportUploadLimitsMiddleware) {}
