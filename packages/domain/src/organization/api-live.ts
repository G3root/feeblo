import { Database, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import { Effect, FileSystem, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "../http/api";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { S3UploadService } from "../services/s3";
import { CurrentSession } from "../session-middleware";
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
          const session = yield* CurrentSession;
          const repository = yield* OrganizationRepository;
          const membership = yield* repository.findMemberRole({
            organizationId,
            userId: session.session.userId,
          });
          const canManageOrganization =
            membership?.role === "owner" || membership?.role === "admin";

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

          const s3Service = yield* S3UploadService;
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

          const db = yield* Database.Database;

          yield* db.execute((client) =>
            client
              .update(schema.organizationTable)
              .set({ logo: uploaded.url })
              .where(eq(schema.organizationTable.id, organizationId))
          );

          return uploaded;
        }).pipe(
          Effect.catchTag("DatabaseError", () =>
            Effect.fail(
              new InternalServerError({
                message: "Failed to update workspace logo",
              })
            )
          )
        );
      }
    )
).pipe(Layer.provide(OrganizationRepository.layer));

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
