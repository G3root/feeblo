import { currentDb, schema } from "@feeblo/db";
import { can } from "@feeblo/permissions";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { AssetRepository } from "../asset/repository";
import { replaceSingletonAsset } from "../asset/service";
import { Api } from "../http/api";
import { UploadLimitsMiddlewareLive } from "../http/upload-limits";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
  withRemapDbErrors,
} from "../rpc-errors";
import { S3UploadService, S3UploadServiceLive } from "../services/s3";
import {
  currentHttpApiSession,
  HttpApiAuthMiddlewareLive,
} from "../session-middleware";
import { OrganizationRepository } from "./repository";

const MAX_ORGANIZATION_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const OrganizationApiLive = HttpApiBuilder.group(
  Api,
  "OrganizationApiGroup",
  (handlers) =>
    handlers.handle(
      "uploadOrganizationLogo",
      ({ payload: { file, organizationId } }) => {
        return Effect.gen(function* () {
          const session = yield* currentHttpApiSession;
          // Explicit permission gate (same `can()` as Policy.canPermission):
          // workspace management is the `workspace.update` grant, which is
          // exactly the roles `isPrivilegedRole` used to hardcode.
          const canManageOrganization = can(
            session,
            organizationId,
            "workspace.update"
          );

          if (!canManageOrganization) {
            return yield* new UnauthorizedError({
              message: "You do not have permission to update this workspace",
            });
          }

          if (!ALLOWED_CONTENT_TYPES.has(file.contentType)) {
            return yield* new BadRequestError({
              message: "Unsupported file type. Use JPEG, PNG, or WEBP",
            });
          }

          const extension = getFileExtension(file.contentType);
          if (!extension) {
            return yield* new BadRequestError({
              message: "Unsupported file type. Use JPEG, PNG, or WEBP",
            });
          }

          const fs = yield* FileSystem.FileSystem;

          // Check the on-disk size before reading the file into memory so an
          // oversized upload cannot exhaust server memory.
          const fileInfo = yield* fs
            .stat(file.path)
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({ message: "Failed to read file" })
              )
            );
          const maxSize = FileSystem.Size(MAX_ORGANIZATION_LOGO_BYTES);
          if (fileInfo.size === FileSystem.Size(0) || fileInfo.size > maxSize) {
            return yield* new BadRequestError({
              message: "Workspace logo must be between 1B and 5MB",
            });
          }

          const bytes = yield* fs
            .readFile(file.path)
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({ message: "Failed to read file" })
              )
            );

          if (
            bytes.length === 0 ||
            bytes.length > MAX_ORGANIZATION_LOGO_BYTES
          ) {
            return yield* new BadRequestError({
              message: "Workspace logo must be between 1B and 5MB",
            });
          }

          const s3Service = yield* S3UploadService.pipe(
            Effect.provide(S3UploadServiceLive),
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Failed to configure media storage",
                })
            )
          );
          const uploaded = yield* s3Service
            .uploadOrganizationLogo({
              bytes,
              extension,
              organizationId,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new InternalServerError({ message: "Failed to upload image" })
              )
            );

          yield* replaceSingletonAsset({
            owner: { type: "organization", id: organizationId },
            kind: "organization_logo",
            uploaded,
            updateOwner: Effect.gen(function* () {
              const db = yield* currentDb;
              yield* db
                .update(schema.organizationTable)
                .set({ logo: uploaded.url })
                .where(eq(schema.organizationTable.id, organizationId));
            }),
          }).pipe(Effect.provideService(S3UploadService, s3Service));

          return uploaded;
        }).pipe(
          Effect.provide(
            Layer.mergeAll(OrganizationRepository.layer, AssetRepository.layer)
          ),
          withRemapDbErrors("Organization", "create")
        );
      }
    )
).pipe(
  Layer.provide(HttpApiAuthMiddlewareLive),
  Layer.provide(UploadLimitsMiddlewareLive)
);

function getFileExtension(contentType: string): string | null {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}
