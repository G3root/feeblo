import { currentDb, schema } from "@feeblo/db";
import {
  asLegid,
  ExternalResourceCreateRequestId,
  IntegrationExternalResourceId,
  PostExternalResourceLinkId,
} from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InternalServerError } from "../../rpc-errors";
import {
  PostExternalResourceLink,
  type RecordPostExternalResourceLink,
} from "./schema";
import { ExternalResourceService } from "./service";

const databaseError = (operation: string) => () =>
  new InternalServerError({
    message: `External resource ${operation} failed.`,
  });

const StoredPostExternalResourceLink = Schema.Struct({
  id: Schema.String,
  connectionId: Schema.String,
  provider: Schema.String,
  providerDisplayName: Schema.String,
  resourceType: Schema.String,
  remoteUrl: Schema.String,
  displayKey: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  stateKey: Schema.NullOr(Schema.String),
  safeMetadata: Schema.Record(Schema.String, Schema.Json),
});

const decodePostLink = (value: unknown) =>
  Schema.decodeUnknownEffect(StoredPostExternalResourceLink)(value).pipe(
    Effect.flatMap((row) =>
      Schema.decodeUnknownEffect(PostExternalResourceLink)({
        ...row,
        id: asLegid(PostExternalResourceLinkId)(row.id),
      })
    ),
    Effect.mapError(databaseError("row decoding"))
  );

/** Database implementation of provider-neutral external-resource storage. */
const makeExternalResourceService = Effect.gen(function* () {
  const db = yield* currentDb;
  const recordPostLink = (input: RecordPostExternalResourceLink) =>
    db
      .transaction(() =>
        Effect.gen(function* () {
          const resourceId = yield* IntegrationExternalResourceId.generate.pipe(
            Effect.mapError(databaseError("identifier generation"))
          );
          const [resource] = yield* db
            .insert(schema.integrationExternalResourceTable)
            .values({
              id: resourceId,
              organizationId: input.resource.organizationId,
              connectionId: input.resource.connectionId,
              resourceType: input.resource.resourceType,
              remoteId: input.resource.remoteId,
              remoteUrl: input.resource.remoteUrl.toString(),
              displayKey: input.resource.displayKey,
              title: input.resource.title,
              stateKey: input.resource.stateKey,
              safeMetadata: input.resource.safeMetadata,
            })
            .onConflictDoUpdate({
              target: [
                schema.integrationExternalResourceTable.connectionId,
                schema.integrationExternalResourceTable.resourceType,
                schema.integrationExternalResourceTable.remoteId,
              ],
              set: {
                remoteUrl: input.resource.remoteUrl.toString(),
                displayKey: input.resource.displayKey,
                title: input.resource.title,
                stateKey: input.resource.stateKey,
                safeMetadata: input.resource.safeMetadata,
              },
            })
            .returning({ id: schema.integrationExternalResourceTable.id })
            .pipe(Effect.mapError(databaseError("resource upsert")));
          if (resource === undefined) {
            return yield* new InternalServerError({
              message: "External resource upsert did not return a resource.",
            });
          }
          const linkId = yield* PostExternalResourceLinkId.generate.pipe(
            Effect.mapError(databaseError("link identifier generation"))
          );
          const [link] = yield* db
            .insert(schema.postExternalResourceLinkTable)
            .values({
              id: linkId,
              organizationId: input.resource.organizationId,
              postId: input.postId,
              externalResourceId: resource.id,
            })
            .onConflictDoNothing()
            .returning({ id: schema.postExternalResourceLinkTable.id })
            .pipe(Effect.mapError(databaseError("post link insert")));
          if (link !== undefined) {
            return {
              externalResourceId: asLegid(IntegrationExternalResourceId)(
                resource.id
              ),
              postExternalResourceLinkId: asLegid(PostExternalResourceLinkId)(
                link.id
              ),
            };
          }
          const existing = yield* db
            .select({ id: schema.postExternalResourceLinkTable.id })
            .from(schema.postExternalResourceLinkTable)
            .where(
              and(
                eq(schema.postExternalResourceLinkTable.postId, input.postId),
                eq(
                  schema.postExternalResourceLinkTable.externalResourceId,
                  resource.id
                )
              )
            )
            .limit(1)
            .pipe(Effect.mapError(databaseError("post link lookup")));
          const existingLink = existing[0];
          if (existingLink === undefined) {
            return yield* new InternalServerError({
              message:
                "External resource post link was not found after conflict.",
            });
          }
          return {
            externalResourceId: asLegid(IntegrationExternalResourceId)(
              resource.id
            ),
            postExternalResourceLinkId: asLegid(PostExternalResourceLinkId)(
              existingLink.id
            ),
          };
        })
      )
      .pipe(Effect.mapError(databaseError("record transaction")));

  return ExternalResourceService.of({
    listPostLinks: (input) =>
      db
        .select({
          id: schema.postExternalResourceLinkTable.id,
          connectionId: schema.integrationExternalResourceTable.connectionId,
          provider: schema.integrationConnectionTable.provider,
          providerDisplayName: schema.integrationConnectionTable.name,
          resourceType: schema.integrationExternalResourceTable.resourceType,
          remoteUrl: schema.integrationExternalResourceTable.remoteUrl,
          displayKey: schema.integrationExternalResourceTable.displayKey,
          title: schema.integrationExternalResourceTable.title,
          stateKey: schema.integrationExternalResourceTable.stateKey,
          safeMetadata: schema.integrationExternalResourceTable.safeMetadata,
        })
        .from(schema.postExternalResourceLinkTable)
        .innerJoin(
          schema.integrationExternalResourceTable,
          eq(
            schema.integrationExternalResourceTable.id,
            schema.postExternalResourceLinkTable.externalResourceId
          )
        )
        .innerJoin(
          schema.integrationConnectionTable,
          eq(
            schema.integrationConnectionTable.id,
            schema.integrationExternalResourceTable.connectionId
          )
        )
        .where(
          and(
            eq(
              schema.postExternalResourceLinkTable.organizationId,
              input.organizationId
            ),
            eq(schema.postExternalResourceLinkTable.postId, input.postId)
          )
        )
        .pipe(
          Effect.mapError(databaseError("link list")),
          Effect.flatMap((rows) => Effect.forEach(rows, decodePostLink))
        ),
    recordPostLink,
    reserveCreation: (input) =>
      Effect.gen(function* () {
        const id = yield* ExternalResourceCreateRequestId.generate.pipe(
          Effect.mapError(databaseError("creation identifier generation"))
        );
        const created = yield* db
          .insert(schema.externalResourceCreateRequestTable)
          .values({
            id,
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            postId: input.postId,
            idempotencyKey: input.idempotencyKey,
            state: "pending",
          })
          .onConflictDoNothing()
          .returning({ id: schema.externalResourceCreateRequestTable.id })
          .pipe(Effect.mapError(databaseError("creation reservation")));
        const inserted = created[0];
        if (inserted !== undefined) {
          return {
            id: asLegid(ExternalResourceCreateRequestId)(inserted.id),
            reserved: true,
            postExternalResourceLinkId: null,
          };
        }
        const [existing] = yield* db
          .select({
            id: schema.externalResourceCreateRequestTable.id,
            postId: schema.externalResourceCreateRequestTable.postId,
            postExternalResourceLinkId:
              schema.externalResourceCreateRequestTable
                .postExternalResourceLinkId,
          })
          .from(schema.externalResourceCreateRequestTable)
          .where(
            and(
              eq(
                schema.externalResourceCreateRequestTable.connectionId,
                input.connectionId
              ),
              eq(
                schema.externalResourceCreateRequestTable.organizationId,
                input.organizationId
              ),
              eq(
                schema.externalResourceCreateRequestTable.idempotencyKey,
                input.idempotencyKey
              )
            )
          )
          .limit(1)
          .pipe(Effect.mapError(databaseError("creation reservation lookup")));
        if (existing === undefined || existing.postId !== input.postId) {
          return yield* new InternalServerError({
            message: "External resource creation reservation was not found.",
          });
        }
        return {
          id: asLegid(ExternalResourceCreateRequestId)(existing.id),
          reserved: false,
          postExternalResourceLinkId:
            existing.postExternalResourceLinkId === null
              ? null
              : asLegid(PostExternalResourceLinkId)(
                  existing.postExternalResourceLinkId
                ),
        };
      }),
    failCreation: (input) =>
      db
        .delete(schema.externalResourceCreateRequestTable)
        .where(
          and(
            eq(schema.externalResourceCreateRequestTable.id, input.requestId),
            eq(schema.externalResourceCreateRequestTable.state, "pending")
          )
        )
        .pipe(
          Effect.mapError(databaseError("creation release")),
          Effect.asVoid
        ),
    completeCreation: (input) =>
      db
        .update(schema.externalResourceCreateRequestTable)
        .set({
          state: "succeeded",
          externalResourceId: input.externalResourceId,
          postExternalResourceLinkId: input.postExternalResourceLinkId,
        })
        .where(
          eq(schema.externalResourceCreateRequestTable.id, input.requestId)
        )
        .pipe(
          Effect.mapError(databaseError("creation completion")),
          Effect.asVoid
        ),
  });
});

/** Live external-resource storage service. */
export const ExternalResourceServiceLive = Layer.effect(
  ExternalResourceService,
  makeExternalResourceService
);
