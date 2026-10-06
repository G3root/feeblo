import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { BoardRepository } from "../board/repository";
import { Api } from "../http/api";
import { PublicApiConfig } from "../public-api/config";
import { consumeDashboardRateLimit } from "../rate-limit";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import {
  currentHttpApiSession,
  HttpApiAuthMiddlewareLive,
} from "../session-middleware";
import { DataImportUploadLimitsMiddlewareLive } from "./api-contract";
import { DataImportFileTooLargeError } from "./errors";
import { streamBoardPostCsv } from "./export-service";
import { DataImportService } from "./import-service";
import { DATA_IMPORT_MAX_BYTES } from "./limits";
import { toDataImportJobSummary } from "./mappers";
import { DataTransferRepository } from "./repository";

/**
 * Content types a browser or spreadsheet program may send for a `.csv`
 * upload. `application/octet-stream` is what a drag-and-drop occasionally
 * arrives as; the bytes are still required to be valid UTF-8 before anything
 * is staged.
 */
const ALLOWED_IMPORT_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
]);

/**
 * The services the handlers read, provided in the handler body.
 *
 * `HttpApiBuilder` does not thread a handler's requirements through the route
 * layer, so a handler that read the ambient context would compile and fail at
 * request time; the dashboard's media upload and the organization API resolve
 * their own services the same way. Building them per request is cheap — these
 * are thin service objects over the process-wide database.
 */
const HandlerDependencies = Layer.mergeAll(
  DataImportService.layer,
  DataTransferRepository.layer,
  BoardRepository.layer,
  PublicApiConfig.layer
).pipe(Layer.orDie);

const parseIncludeArchived = (
  value: string | undefined
): Effect.Effect<boolean, BadRequestError> => {
  if (value === undefined || value === "false") {
    return Effect.succeed(false);
  }
  if (value === "true") {
    return Effect.succeed(true);
  }
  return Effect.fail(
    new BadRequestError({
      message: "includeArchived must be true or false.",
    })
  );
};

export const DataTransferApiLive = HttpApiBuilder.group(
  Api,
  "DataTransferApiGroup",
  (handlers) =>
    handlers
      .handle(
        "uploadBoardImport",
        ({ payload: { boardId, file, organizationId } }) =>
          Effect.gen(function* () {
            const session = yield* currentHttpApiSession;
            yield* consumeDashboardRateLimit({
              key: `data-import-upload:${session.user.id}`,
              name: "data-import-upload",
            });

            const membership = session.memberships.find(
              (candidate) => candidate.organizationId === organizationId
            );
            if (membership === undefined) {
              return yield* new UnauthorizedError({
                message: "You are not a member of this organization",
              });
            }
            if (!ALLOWED_IMPORT_CONTENT_TYPES.has(file.contentType)) {
              return yield* new BadRequestError({
                message: "Upload a CSV file.",
              });
            }

            const fs = yield* FileSystem.FileSystem;
            const readFailure = () =>
              new InternalServerError({
                message: "Could not read the uploaded file.",
              });
            const info = yield* fs
              .stat(file.path)
              .pipe(Effect.mapError(readFailure));
            if (info.size > ByteSize.bytes(DATA_IMPORT_MAX_BYTES)) {
              return yield* new DataImportFileTooLargeError({
                maxBytes: DATA_IMPORT_MAX_BYTES,
                message: `The file is larger than ${Math.round(
                  DATA_IMPORT_MAX_BYTES / (1024 * 1024)
                )} MB.`,
              });
            }
            const bytes = yield* fs
              .readFile(file.path)
              .pipe(Effect.mapError(readFailure));

            const service = yield* DataImportService;
            const job = yield* service.stageBoardImport({
              boardId,
              bytes,
              fileName: file.name,
              memberId: membership.membershipId,
              organizationId,
              userId: session.user.id,
            });
            return toDataImportJobSummary(job);
            // eslint-disable-next-line effecttsgo/strict-effect-provide -- HttpApiBuilder handlers resolve their own services (the same shape as the media upload)
          }).pipe(Effect.provide(HandlerDependencies))
      )
      .handle("exportBoardPosts", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* currentHttpApiSession;
          yield* consumeDashboardRateLimit({
            key: `data-export:${session.user.id}`,
            name: "data-export",
          });
          const includeArchived = yield* parseIncludeArchived(
            query.includeArchived
          );
          const exportFile = yield* streamBoardPostCsv({
            boardId: query.boardId,
            includeArchived,
            organizationId: query.organizationId,
          });
          return HttpServerResponse.stream(exportFile.stream, {
            contentType: "text/csv; charset=utf-8",
            headers: {
              "Content-Disposition": `attachment; filename="${exportFile.fileName}"`,
            },
          });
          // eslint-disable-next-line effecttsgo/strict-effect-provide -- HttpApiBuilder handlers resolve their own services (the same shape as the media upload)
        }).pipe(Effect.provide(HandlerDependencies))
      )
).pipe(
  Layer.provide(HttpApiAuthMiddlewareLive),
  Layer.provide(DataImportUploadLimitsMiddlewareLive)
);
