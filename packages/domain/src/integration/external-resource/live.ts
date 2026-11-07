import { currentDb, schema } from "@feeblo/db";
import {
  asLegid,
  ExternalResourceCreateRequestId,
  IntegrationExternalResourceId,
  PostExternalResourceLinkId,
} from "@feeblo/id";
import { isHttpUrl } from "@feeblo/utils/http-url";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { InternalServerError } from "../../rpc-errors";
import {
  RESERVED_CREATE_REQUEST_STATE,
  sourceStatesFor,
  targetStateFor,
} from "./machine";
import {
  PostExternalResourceLink,
  type RecordPostExternalResourceLink,
} from "./schema";
import { ExternalResourceService } from "./service";

const databaseError = (operation: string) => () =>
  new InternalServerError({
    message: `External resource ${operation} failed.`,
  });

/**
 * Rejects a provider-supplied URL the dashboard would render as a link.
 *
 * The typed schema (`HttpUrl`) already says http(s), but providers build
 * drafts as plain values rather than through a decoder, so this is the one
 * runtime chokepoint every provider — the delivery worker and the
 * user-requested GitHub issue path — writes through. A `javascript:` or
 * `data:` URL stored here would execute in the dashboard's origin on click.
 */
const requireHttpRemoteUrl = (remoteUrl: URL) =>
  isHttpUrl(remoteUrl.toString())
    ? Effect.void
    : Effect.fail(
        new InternalServerError({
          message: "External resource URL must use http or https.",
        })
      );

const decodePostLink = (value: Schema.Json) =>
  Schema.decodeUnknownEffect(PostExternalResourceLink)(value).pipe(
    Effect.mapError(databaseError("row decoding"))
  );

/**
 * A creation reservation older than this is reclaimed so a crashed process
 * cannot wedge its idempotency key in `pending` forever.
 */
const creationReservationStaleMs = 60 * 60 * 1000;

/** Database implementation of provider-neutral external-resource storage. */
const makeExternalResourceService = Effect.gen(function* () {
  const db = yield* currentDb;
  const recordPostLink = (input: RecordPostExternalResourceLink) =>
    db
      .transaction(() =>
        Effect.gen(function* () {
          yield* requireHttpRemoteUrl(input.resource.remoteUrl);
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
        // The claim's fence. Every claim writes `createdAt` itself — the insert
        // below and the re-claim further down — so the instant handed back to
        // the caller is exactly the instant stored, and
        // `completeCreation`/`failCreation` can match it by equality.
        const claimedAt = yield* DateTime.nowAsDate;
        const created = yield* db
          .insert(schema.externalResourceCreateRequestTable)
          .values({
            id,
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            postId: input.postId,
            idempotencyKey: input.idempotencyKey,
            state: RESERVED_CREATE_REQUEST_STATE,
            createdAt: claimedAt,
          })
          .onConflictDoNothing()
          .returning({ id: schema.externalResourceCreateRequestTable.id })
          .pipe(Effect.mapError(databaseError("creation reservation")));
        const inserted = created[0];
        if (inserted !== undefined) {
          return {
            id: asLegid(ExternalResourceCreateRequestId)(inserted.id),
            reserved: true,
            reservedAt: claimedAt,
            postExternalResourceLinkId: null,
          };
        }
        // The reservation is the idempotency key's mutex, so taking it over is
        // **one** statement. A read followed by a guarded `UPDATE` lets two
        // callers read the same reclaimable row and both believe they won;
        // here the row the first caller moves no longer satisfies the
        // predicate the second one evaluates.
        //
        // Two things are reclaimable, and both come from the graph: a `failed`
        // reservation (`sourceStatesFor("reclaim")`), and a `pending` one whose
        // lease expired. The second is re-claimed in place — the row does not
        // move — so it is a lease predicate on an unchanged state rather than
        // an edge.
        const staleBefore = DateTime.toDateUtc(
          DateTime.subtractDuration(
            DateTime.fromDateUnsafe(claimedAt),
            Duration.millis(creationReservationStaleMs)
          )
        );
        const [reclaimed] = yield* db
          .update(schema.externalResourceCreateRequestTable)
          .set({
            state: targetStateFor("reclaim"),
            externalResourceId: null,
            postExternalResourceLinkId: null,
            // Moving `createdAt` is what makes this a new claim generation,
            // and therefore what stops the previous holder's writes from
            // matching. `GREATEST` keeps the new stamp strictly ahead of the
            // old one even when the clock does not advance between the two
            // claims — re-claiming a `failed` row needs no elapsed time — so
            // two generations can never share a stamp.
            createdAt: sql`GREATEST(${claimedAt}, ${schema.externalResourceCreateRequestTable.createdAt} + interval '1 millisecond')`,
            updatedAt: claimedAt,
          })
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
              ),
              eq(
                schema.externalResourceCreateRequestTable.postId,
                input.postId
              ),
              or(
                inArray(schema.externalResourceCreateRequestTable.state, [
                  ...sourceStatesFor("reclaim"),
                ]),
                and(
                  inArray(schema.externalResourceCreateRequestTable.state, [
                    ...sourceStatesFor("succeed"),
                  ]),
                  lt(
                    schema.externalResourceCreateRequestTable.createdAt,
                    staleBefore
                  )
                )
              )
            )
          )
          .returning({
            createdAt: schema.externalResourceCreateRequestTable.createdAt,
            id: schema.externalResourceCreateRequestTable.id,
          })
          .pipe(Effect.mapError(databaseError("creation reservation reclaim")));
        if (reclaimed !== undefined) {
          return {
            id: asLegid(ExternalResourceCreateRequestId)(reclaimed.id),
            reserved: true,
            reservedAt: reclaimed.createdAt,
            postExternalResourceLinkId: null,
          };
        }

        // Nothing was claimable: the reservation is held by a live attempt,
        // already succeeded, or belongs to another post. The read below tells
        // those apart and hands back whatever link already exists.
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
      Effect.gen(function* () {
        // Read through `Clock`, not `new Date()`: a wall-clock read inside an
        // Effect is what `effecttsgo/global-date-in-effect` reports, and it is
        // the one thing a `TestClock` test cannot pin.
        const updatedAt = yield* DateTime.nowAsDate;
        const released = yield* db
          .update(schema.externalResourceCreateRequestTable)
          .set({ state: targetStateFor("fail"), updatedAt })
          .where(
            and(
              eq(schema.externalResourceCreateRequestTable.id, input.requestId),
              inArray(schema.externalResourceCreateRequestTable.state, [
                ...sourceStatesFor("fail"),
              ]),
              // `state` alone cannot fence this: a re-claimed row is `pending`
              // again, so the expired holder's release would match it. The
              // claim instant is what tells the two apart.
              eq(
                schema.externalResourceCreateRequestTable.createdAt,
                input.reservedAt
              )
            )
          )
          .returning({ id: schema.externalResourceCreateRequestTable.id })
          .pipe(Effect.mapError(databaseError("creation release")));
        return released.length === 1;
      }),
    completeCreation: (input) =>
      Effect.gen(function* () {
        const completed = yield* db
          .update(schema.externalResourceCreateRequestTable)
          .set({
            state: targetStateFor("succeed"),
            externalResourceId: input.externalResourceId,
            postExternalResourceLinkId: input.postExternalResourceLinkId,
          })
          .where(
            and(
              eq(schema.externalResourceCreateRequestTable.id, input.requestId),
              inArray(schema.externalResourceCreateRequestTable.state, [
                ...sourceStatesFor("succeed"),
              ]),
              eq(
                schema.externalResourceCreateRequestTable.createdAt,
                input.reservedAt
              )
            )
          )
          .returning({ id: schema.externalResourceCreateRequestTable.id })
          .pipe(Effect.mapError(databaseError("creation completion")));
        return completed.length === 1;
      }),
  });
});

/** Live external-resource storage service. */
export const ExternalResourceServiceLive = Layer.effect(
  ExternalResourceService,
  makeExternalResourceService
);
