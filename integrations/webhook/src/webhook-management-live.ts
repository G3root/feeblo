import { currentDb, schema } from "@feeblo/db";
import {
  IntegrationRouteEventSelection,
  SUBSCRIBABLE_INTEGRATION_EVENT_TYPES,
} from "@feeblo/db/validation-schema/integration";
import { WebhookIntegrationConfig } from "@feeblo/domain/integration/config";
import { WebhookManagementErrors } from "@feeblo/domain/integration/errors";
import { WebhookDeliveryHistoryPage } from "@feeblo/domain/integration/schema";
import { WebhookManagementService } from "@feeblo/domain/integration/webhook-management-service";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "@feeblo/domain/rpc-errors";
import {
  asLegid,
  BoardId,
  IntegrationConnectionId,
  IntegrationDeliveryAttemptId,
  IntegrationDeliveryId,
  IntegrationEventId,
  IntegrationRouteId,
  MemberId,
  PostId,
  PostStatusId,
} from "@feeblo/id";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  decryptWebhookCredentialMaterial,
  encryptWebhookCredentialMaterial,
  generateWebhookSigningSecret,
  resolveAndParseWebhookEndpoint,
  rotateWebhookSigningKeyring,
} from "./index";
import {
  webhookEventsPostCapabilityKey,
  webhookProviderKey,
} from "./webhook-manifest";

const retentionMs = 30 * 24 * 60 * 60 * 1000;
const subscribableEventTypes = SUBSCRIBABLE_INTEGRATION_EVENT_TYPES;

const WebhookSafeDisplayMetadata = Schema.Struct({ hostname: Schema.String });

const decodeWebhookSafeDisplayMetadata = (value: Schema.Json) =>
  Schema.decodeUnknownEffect(WebhookSafeDisplayMetadata)(value).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Stored webhook display metadata is invalid",
        })
    )
  );

const decodeWebhookRouteEventSelection = (value: Schema.Json) =>
  Schema.decodeUnknownEffect(IntegrationRouteEventSelection)(value).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Stored webhook event selection is invalid",
        })
    )
  );

const mapManagementError = (operation: string) =>
  Effect.mapError((error) =>
    Schema.is(WebhookManagementErrors)(error)
      ? error
      : new InternalServerError({
          message: `Webhook ${operation} failed`,
        })
  );

const endpointHealth = (connection: {
  readonly lastFailedAt: Date | null;
  readonly lastSucceededAt: Date | null;
  readonly lifecycle: string;
}) => {
  if (connection.lifecycle === "paused") {
    return "paused" as const;
  }
  if (
    connection.lastFailedAt !== null &&
    (connection.lastSucceededAt === null ||
      connection.lastFailedAt > connection.lastSucceededAt)
  ) {
    return "failing" as const;
  }
  return "healthy" as const;
};

const visibleWebhookLifecycle = (
  lifecycle: typeof schema.integrationConnectionTable.$inferSelect.lifecycle
) => (lifecycle === "archived" ? ("disconnected" as const) : lifecycle);

/** Composite keyset cursor: `{createdAtISO}~{deliveryId}`; the ID disambiguates equal timestamps. */
const encodeHistoryCursor = (delivery: {
  readonly createdAt: Date;
  readonly id: string;
}): string => `${delivery.createdAt.toISOString()}~${delivery.id}`;

const decodeHistoryCursor = (
  cursor: string | undefined
): Effect.Effect<
  Option.Option<{ readonly beforeId: string; readonly beforeTime: Date }>,
  BadRequestError
> => {
  if (cursor === undefined) {
    return Effect.succeed(Option.none());
  }
  const separatorIndex = cursor.lastIndexOf("~");
  const timePart =
    separatorIndex === -1 ? undefined : cursor.slice(0, separatorIndex);
  const idPart =
    separatorIndex === -1 ? undefined : cursor.slice(separatorIndex + 1);
  if (timePart === undefined || idPart === undefined || idPart.length === 0) {
    return Effect.fail(
      new BadRequestError({ message: "Webhook history cursor is invalid" })
    );
  }
  return Schema.decodeUnknownEffect(Schema.DateFromString)(timePart).pipe(
    Effect.map((beforeTime) => Option.some({ beforeId: idPart, beforeTime })),
    Effect.mapError(
      () =>
        new BadRequestError({ message: "Webhook history cursor is invalid" })
    )
  );
};

/** Live webhook endpoint management service backed by the PostgreSQL schema. */
export const WebhookManagementServiceLive = Layer.effect(
  WebhookManagementService,
  Effect.gen(function* () {
    const db = yield* currentDb;
    const { encryptionKey, endpointSecurityPolicy } =
      yield* WebhookIntegrationConfig;

    const lockWebhookConnection = (
      connectionId: string,
      organizationId: string
    ) =>
      db
        .select()
        .from(schema.integrationConnectionTable)
        .where(
          and(
            eq(schema.integrationConnectionTable.id, connectionId),
            eq(
              schema.integrationConnectionTable.organizationId,
              organizationId
            ),
            eq(schema.integrationConnectionTable.provider, webhookProviderKey)
          )
        )
        .for("update")
        .limit(1);

    const listEndpoints = Effect.fn("WebhookManagement.listEndpoints")(
      function* ({ organizationId }: { readonly organizationId: string }) {
        const rows = yield* db
          .select({
            connection: schema.integrationConnectionTable,
            route: schema.integrationRouteTable,
          })
          .from(schema.integrationConnectionTable)
          .innerJoin(
            schema.integrationRouteTable,
            eq(
              schema.integrationRouteTable.connectionId,
              schema.integrationConnectionTable.id
            )
          )
          .where(
            and(
              eq(
                schema.integrationConnectionTable.organizationId,
                organizationId
              ),
              eq(
                schema.integrationConnectionTable.provider,
                webhookProviderKey
              ),
              inArray(schema.integrationConnectionTable.lifecycle, [
                "connecting",
                "active",
                "paused",
                "reauth_required",
                "disconnecting",
                "disconnected",
                "revocation_unconfirmed",
              ])
            )
          )
          .orderBy(desc(schema.integrationConnectionTable.createdAt));
        return yield* Effect.forEach(rows, ({ connection, route }) =>
          Effect.all({
            metadata: decodeWebhookSafeDisplayMetadata(
              connection.safeDisplayMetadata ?? {}
            ),
            selectedEventTypes: decodeWebhookRouteEventSelection(
              route.eventTypes
            ),
          }).pipe(
            Effect.map(({ metadata, selectedEventTypes }) => ({
              eventTypes: subscribableEventTypes.filter((type) =>
                selectedEventTypes.includes(type)
              ),
              health: endpointHealth(connection),
              hostname: metadata.hostname,
              id: asLegid(IntegrationConnectionId)(connection.id),
              lastFailedAt: connection.lastFailedAt,
              lastSucceededAt: connection.lastSucceededAt,
              lifecycle: visibleWebhookLifecycle(connection.lifecycle),
              name: connection.name,
            }))
          )
        );
      },
      (effect) => effect.pipe(mapManagementError("list"))
    );

    const createEndpoint = Effect.fn("WebhookManagement.createEndpoint")(
      function* (input: {
        readonly endpointUrl: string;
        readonly eventTypes: readonly (typeof subscribableEventTypes)[number][];
        readonly name: string;
        readonly organizationId: string;
      }) {
        const validated = yield* resolveAndParseWebhookEndpoint(
          input.endpointUrl,
          endpointSecurityPolicy
        ).pipe(
          Effect.mapError(
            () =>
              new BadRequestError({
                message: "Webhook endpoint URL is not allowed",
              })
          )
        );
        const signingSecret = yield* generateWebhookSigningSecret();
        const ciphertext = yield* encryptWebhookCredentialMaterial(
          encryptionKey,
          {
            endpointUrl: input.endpointUrl,
            signingKeyring: { current: Redacted.value(signingSecret) },
          }
        ).pipe(
          Effect.mapError(
            () =>
              new InternalServerError({
                message: "Webhook credentials could not be encrypted",
              })
          )
        );
        const connectionId = yield* IntegrationConnectionId.generate;
        const routeId = yield* IntegrationRouteId.generate;
        yield* db.transaction(() =>
          Effect.gen(function* () {
            yield* db.insert(schema.integrationConnectionTable).values({
              credentialGeneration: 1,
              credentialsCiphertext: ciphertext,
              id: connectionId,
              lifecycle: "active",
              name: input.name,
              organizationId: input.organizationId,
              provider: webhookProviderKey,
              safeDisplayMetadata: { hostname: validated.hostname },
            });
            yield* db.insert(schema.integrationRouteTable).values({
              capabilityKey: webhookEventsPostCapabilityKey,
              configVersion: 1,
              connectionId,
              enabled: true,
              eventTypes: input.eventTypes,
              id: routeId,
              organizationId: input.organizationId,
              providerConfig: {},
              routeKey: "",
              safeDisplayMetadata: {},
            });
          })
        );
        return {
          endpoint: {
            eventTypes: [...input.eventTypes],
            health: "healthy" as const,
            hostname: validated.hostname,
            id: connectionId,
            lastFailedAt: null,
            lastSucceededAt: null,
            lifecycle: "active" as const,
            name: input.name,
          },
          signingSecret: Redacted.value(signingSecret),
        };
      },
      (effect) => effect.pipe(mapManagementError("create"))
    );

    const updateEndpoint = Effect.fn("WebhookManagement.updateEndpoint")(
      function* (input: {
        readonly connectionId: string;
        readonly endpointUrl?: string;
        readonly eventTypes?: readonly (typeof subscribableEventTypes)[number][];
        readonly name?: string;
        readonly organizationId: string;
      }) {
        const validated =
          input.endpointUrl === undefined
            ? undefined
            : yield* resolveAndParseWebhookEndpoint(
                input.endpointUrl,
                endpointSecurityPolicy
              ).pipe(
                Effect.mapError(
                  () =>
                    new BadRequestError({
                      message: "Webhook endpoint URL is not allowed",
                    })
                )
              );
        return yield* db.transaction(() =>
          Effect.gen(function* () {
            const [existing] = yield* lockWebhookConnection(
              input.connectionId,
              input.organizationId
            );
            if (
              existing === undefined ||
              (existing.lifecycle !== "active" &&
                existing.lifecycle !== "paused")
            ) {
              return yield* new NotFoundError({
                message: "Webhook endpoint was not found",
              });
            }
            let { hostname } = yield* decodeWebhookSafeDisplayMetadata(
              existing.safeDisplayMetadata ?? {}
            );
            let credentialsCiphertext = existing.credentialsCiphertext;
            if (input.endpointUrl !== undefined && validated !== undefined) {
              if (credentialsCiphertext === null) {
                return yield* new NotFoundError({
                  message: "Webhook endpoint was not found",
                });
              }
              const credentials = yield* decryptWebhookCredentialMaterial(
                encryptionKey,
                credentialsCiphertext
              ).pipe(
                Effect.mapError(
                  () =>
                    new InternalServerError({
                      message: "Webhook credentials could not be decrypted",
                    })
                )
              );
              credentialsCiphertext = yield* encryptWebhookCredentialMaterial(
                encryptionKey,
                {
                  endpointUrl: input.endpointUrl,
                  signingKeyring: {
                    current: Redacted.value(credentials.signingKeyring.current),
                    ...(credentials.signingKeyring.previous !== undefined && {
                      previous: {
                        expiresAt: DateTime.makeUnsafe(
                          credentials.signingKeyring.previous.expiresAt
                        ),
                        secret: Redacted.value(
                          credentials.signingKeyring.previous.secret
                        ),
                      },
                    }),
                  },
                }
              ).pipe(
                Effect.mapError(
                  () =>
                    new InternalServerError({
                      message: "Webhook credentials could not be encrypted",
                    })
                )
              );
              hostname = validated.hostname;
            }
            yield* db
              .update(schema.integrationConnectionTable)
              .set({
                ...(input.name === undefined
                  ? undefined
                  : { name: input.name }),
                credentialsCiphertext,
                safeDisplayMetadata: { hostname },
              })
              .where(
                and(
                  eq(schema.integrationConnectionTable.id, input.connectionId),
                  eq(
                    schema.integrationConnectionTable.organizationId,
                    input.organizationId
                  )
                )
              );
            if (input.eventTypes !== undefined) {
              yield* db
                .update(schema.integrationRouteTable)
                .set({ eventTypes: input.eventTypes })
                .where(
                  and(
                    eq(
                      schema.integrationRouteTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    )
                  )
                );
            }
            const [route] = yield* db
              .select()
              .from(schema.integrationRouteTable)
              .where(
                and(
                  eq(
                    schema.integrationRouteTable.connectionId,
                    input.connectionId
                  ),
                  eq(
                    schema.integrationRouteTable.organizationId,
                    input.organizationId
                  )
                )
              )
              .limit(1);
            const selectedEventTypes = yield* decodeWebhookRouteEventSelection(
              route?.eventTypes ?? []
            );
            return {
              eventTypes: subscribableEventTypes.filter((type) =>
                selectedEventTypes.includes(type)
              ),
              health: endpointHealth(existing),
              hostname,
              id: asLegid(IntegrationConnectionId)(existing.id),
              lastFailedAt: existing.lastFailedAt,
              lastSucceededAt: existing.lastSucceededAt,
              lifecycle: existing.lifecycle,
              name: input.name ?? existing.name,
            };
          })
        );
      },
      (effect) => effect.pipe(mapManagementError("update"))
    );

    const pauseEndpoint = Effect.fn("WebhookManagement.pauseEndpoint")(
      function* (input: {
        readonly connectionId: string;
        readonly organizationId: string;
      }) {
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockWebhookConnection(
                input.connectionId,
                input.organizationId
              );
              if (
                connection === undefined ||
                (connection.lifecycle !== "active" &&
                  connection.lifecycle !== "paused")
              ) {
                return yield* new NotFoundError({
                  message: "Webhook endpoint was not found",
                });
              }
              const now = yield* DateTime.nowAsDate;
              yield* db
                .update(schema.integrationConnectionTable)
                .set({ lifecycle: "paused", updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationConnectionTable.id,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationConnectionTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.integrationConnectionTable.lifecycle, "active")
                  )
                );
              yield* db
                .update(schema.integrationRouteTable)
                .set({ enabled: false, updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationRouteTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    )
                  )
                );
              yield* db
                .update(schema.integrationDeliveryTable)
                .set({ canceledAt: now, state: "canceled", updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationDeliveryTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.integrationDeliveryTable.state, "pending")
                  )
                );
            })
          )
          .pipe(mapManagementError("pause"));
      }
    );

    const resumeEndpoint = Effect.fn("WebhookManagement.resumeEndpoint")(
      function* (input: {
        readonly connectionId: string;
        readonly organizationId: string;
      }) {
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockWebhookConnection(
                input.connectionId,
                input.organizationId
              );
              if (
                connection === undefined ||
                (connection.lifecycle !== "active" &&
                  connection.lifecycle !== "paused")
              ) {
                return yield* new NotFoundError({
                  message: "Webhook endpoint was not found",
                });
              }
              const now = yield* DateTime.nowAsDate;
              yield* db
                .update(schema.integrationConnectionTable)
                .set({
                  consecutiveExhaustedDeliveries: 0,
                  lifecycle: "active",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(
                      schema.integrationConnectionTable.id,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationConnectionTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.integrationConnectionTable.lifecycle, "paused")
                  )
                );
              yield* db
                .update(schema.integrationRouteTable)
                .set({ enabled: true, updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationRouteTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    )
                  )
                );
            })
          )
          .pipe(mapManagementError("resume"));
      }
    );

    const removeEndpoint = Effect.fn("WebhookManagement.removeEndpoint")(
      function* (input: {
        readonly connectionId: string;
        readonly organizationId: string;
      }) {
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockWebhookConnection(
                input.connectionId,
                input.organizationId
              );
              if (connection === undefined) {
                return yield* new NotFoundError({
                  message: "Webhook endpoint was not found",
                });
              }
              if (connection.lifecycle === "archived") {
                return;
              }
              const now = yield* DateTime.nowAsDate;
              yield* db
                .update(schema.integrationConnectionTable)
                .set({
                  archivedAt: now,
                  credentialsCiphertext: null,
                  lifecycle: "archived",
                  retentionExpiresAt: new Date(now.getTime() + retentionMs),
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(
                      schema.integrationConnectionTable.id,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationConnectionTable.organizationId,
                      input.organizationId
                    )
                  )
                );
              yield* db
                .update(schema.integrationRouteTable)
                .set({ enabled: false, updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationRouteTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    )
                  )
                );
              yield* db
                .update(schema.integrationDeliveryTable)
                .set({ canceledAt: now, state: "canceled", updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationDeliveryTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.integrationDeliveryTable.state, "pending")
                  )
                );
            })
          )
          .pipe(mapManagementError("remove"));
      }
    );

    const rotateSecret = Effect.fn("WebhookManagement.rotateSecret")(
      function* (input: {
        readonly connectionId: string;
        readonly organizationId: string;
      }) {
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockWebhookConnection(
                input.connectionId,
                input.organizationId
              );
              if (
                connection?.credentialsCiphertext === null ||
                connection?.credentialsCiphertext === undefined ||
                (connection.lifecycle !== "active" &&
                  connection.lifecycle !== "paused")
              ) {
                return yield* new NotFoundError({
                  message: "Webhook endpoint was not found",
                });
              }
              const credentials = yield* decryptWebhookCredentialMaterial(
                encryptionKey,
                connection.credentialsCiphertext
              ).pipe(
                Effect.mapError(
                  () =>
                    new InternalServerError({
                      message: "Webhook credentials could not be decrypted",
                    })
                )
              );
              const keyring = yield* rotateWebhookSigningKeyring(
                credentials.signingKeyring
              );
              const ciphertext = yield* encryptWebhookCredentialMaterial(
                encryptionKey,
                {
                  endpointUrl: Redacted.value(credentials.endpointUrl),
                  signingKeyring: {
                    current: Redacted.value(keyring.current),
                    ...(keyring.previous !== undefined && {
                      previous: {
                        expiresAt: DateTime.makeUnsafe(
                          keyring.previous.expiresAt
                        ),
                        secret: Redacted.value(keyring.previous.secret),
                      },
                    }),
                  },
                }
              ).pipe(
                Effect.mapError(
                  () =>
                    new InternalServerError({
                      message: "Webhook credentials could not be encrypted",
                    })
                )
              );
              yield* db
                .update(schema.integrationConnectionTable)
                .set({
                  credentialsCiphertext: ciphertext,
                  credentialGeneration: sql`${schema.integrationConnectionTable.credentialGeneration} + 1`,
                })
                .where(
                  and(
                    eq(
                      schema.integrationConnectionTable.id,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationConnectionTable.organizationId,
                      input.organizationId
                    )
                  )
                );
              return { signingSecret: Redacted.value(keyring.current) };
            })
          )
          .pipe(mapManagementError("secret rotation"));
      }
    );

    const sendTestDelivery = Effect.fn("WebhookManagement.sendTestDelivery")(
      function* (input: {
        readonly connectionId: string;
        readonly organizationId: string;
      }) {
        const { connectionId, organizationId } = input;
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockWebhookConnection(
                input.connectionId,
                input.organizationId
              );
              if (
                connection === undefined ||
                connection.lifecycle !== "active"
              ) {
                return yield* new NotFoundError({
                  message: "Webhook endpoint was not found",
                });
              }
              const [route] = yield* db
                .select()
                .from(schema.integrationRouteTable)
                .where(
                  and(
                    eq(
                      schema.integrationRouteTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    )
                  )
                )
                .limit(1);
              if (route === undefined || !route.enabled) {
                return yield* new NotFoundError({
                  message: "Webhook endpoint was not found",
                });
              }
              const eventId = yield* IntegrationEventId.generate;
              const deliveryId = yield* IntegrationDeliveryId.generate;
              const boardId = yield* BoardId.generate;
              const memberId = yield* MemberId.generate;
              const postId = yield* PostId.generate;
              const statusId = yield* PostStatusId.generate;
              const now = yield* DateTime.nowAsDate;
              yield* db.insert(schema.integrationEventTable).values({
                causalHopCount: 0,
                correlationId: eventId,
                id: eventId,
                occurredAt: now,
                organizationId,
                origin: { kind: "feeblo" },
                payload: {
                  actor: {
                    displayName: "Webhook test",
                    kind: "member",
                    memberId,
                  },
                  board: {
                    id: boardId,
                    name: "Synthetic test board",
                    slug: "webhook-test",
                  },
                  post: {
                    id: postId,
                    status: { id: statusId, type: "PENDING" },
                    title: "Synthetic webhook test",
                    url: "https://example.invalid/webhook-test",
                  },
                },
                retentionExpiresAt: new Date(now.getTime() + retentionMs),
                type: "webhook.test",
                version: 1,
              });
              yield* db.insert(schema.integrationDeliveryTable).values({
                actionKey: `webhook.test:${route.id}`,
                connectionId,
                eventId,
                id: deliveryId,
                nextAttemptAt: now,
                organizationId,
                retentionExpiresAt: new Date(now.getTime() + retentionMs),
                routeId: route.id,
                state: "pending",
              });
              return { deliveryId, result: "queued" as const };
            })
          )
          .pipe(mapManagementError("test delivery"));
      }
    );

    const getDeliveryHistory = Effect.fn(
      "WebhookManagement.getDeliveryHistory"
    )(
      function* (input: {
        readonly connectionId: string;
        readonly cursor?: string;
        readonly limit?: number;
        readonly organizationId: string;
      }) {
        const before = yield* decodeHistoryCursor(input.cursor);
        const pageSize = Math.min(Math.max(input.limit ?? 20, 1), 100);
        const rows = yield* db
          .select({
            delivery: schema.integrationDeliveryTable,
            event: schema.integrationEventTable,
          })
          .from(schema.integrationDeliveryTable)
          .innerJoin(
            schema.integrationEventTable,
            eq(
              schema.integrationDeliveryTable.eventId,
              schema.integrationEventTable.id
            )
          )
          .where(
            and(
              eq(
                schema.integrationDeliveryTable.connectionId,
                input.connectionId
              ),
              eq(
                schema.integrationDeliveryTable.organizationId,
                input.organizationId
              ),
              ...(Option.isNone(before)
                ? []
                : [
                    or(
                      lt(
                        schema.integrationDeliveryTable.createdAt,
                        before.value.beforeTime
                      ),
                      and(
                        eq(
                          schema.integrationDeliveryTable.createdAt,
                          before.value.beforeTime
                        ),
                        lt(
                          schema.integrationDeliveryTable.id,
                          before.value.beforeId
                        )
                      )
                    ),
                  ])
            )
          )
          .orderBy(
            desc(schema.integrationDeliveryTable.createdAt),
            desc(schema.integrationDeliveryTable.id)
          )
          .limit(pageSize + 1);
        const pageRows = rows.slice(0, pageSize);
        const lastPageRow = pageRows.at(-1);
        const nextCursor =
          rows.length > pageRows.length && lastPageRow !== undefined
            ? encodeHistoryCursor(lastPageRow.delivery)
            : null;
        const attempts =
          pageRows.length === 0
            ? []
            : yield* db
                .select()
                .from(schema.integrationDeliveryAttemptTable)
                .where(
                  inArray(
                    schema.integrationDeliveryAttemptTable.deliveryId,
                    pageRows.map(({ delivery }) => delivery.id)
                  )
                )
                .orderBy(
                  desc(schema.integrationDeliveryAttemptTable.startedAt)
                );
        return yield* Schema.decodeUnknownEffect(WebhookDeliveryHistoryPage)({
          items: pageRows.map(({ delivery, event }) => ({
            attempts: attempts
              .filter((attempt) => attempt.deliveryId === delivery.id)
              .map((attempt) => ({
                completedAt: attempt.finishedAt?.toISOString() ?? null,
                durationMs: attempt.durationMs,
                errorTag: attempt.errorTag,
                httpStatus: attempt.httpStatus,
                id: asLegid(IntegrationDeliveryAttemptId)(attempt.id),
                // In-flight attempts have no retry decision yet; null is the
                // truthful wire value and the schema models it as such.
                retryDecision: attempt.retryDecision,
                startedAt: attempt.startedAt.toISOString(),
              })),
            attemptCount: delivery.attemptCount,
            createdAt: delivery.createdAt.toISOString(),
            eventType: event.type,
            id: asLegid(IntegrationDeliveryId)(delivery.id),
            nextAttemptAt: delivery.nextAttemptAt.toISOString(),
            routeId: asLegid(IntegrationRouteId)(delivery.routeId),
            state: delivery.state,
          })),
          nextCursor,
        }).pipe(
          Effect.mapError(
            () =>
              new InternalServerError({ message: "Webhook history is invalid" })
          )
        );
      },
      (effect) => effect.pipe(mapManagementError("history"))
    );

    const retryDelivery = Effect.fn("WebhookManagement.retryDelivery")(
      function* (input: {
        readonly deliveryId: string;
        readonly organizationId: string;
      }) {
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [delivery] = yield* db
                .select({
                  connectionId: schema.integrationDeliveryTable.connectionId,
                  routeId: schema.integrationDeliveryTable.routeId,
                })
                .from(schema.integrationDeliveryTable)
                .where(
                  and(
                    eq(schema.integrationDeliveryTable.id, input.deliveryId),
                    eq(
                      schema.integrationDeliveryTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.integrationDeliveryTable.state, "exhausted")
                  )
                )
                .limit(1);
              if (delivery === undefined) {
                return yield* new NotFoundError({
                  message:
                    "Webhook delivery was not found or is unavailable for retry",
                });
              }
              const [connection] = yield* lockWebhookConnection(
                delivery.connectionId,
                input.organizationId
              );
              const [route] = yield* db
                .select({ enabled: schema.integrationRouteTable.enabled })
                .from(schema.integrationRouteTable)
                .where(
                  and(
                    eq(schema.integrationRouteTable.id, delivery.routeId),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    )
                  )
                )
                .limit(1);
              if (
                connection?.lifecycle !== "active" ||
                route?.enabled !== true
              ) {
                return yield* new BadRequestError({
                  message:
                    "Resume the webhook endpoint before retrying delivery",
                });
              }
              const now = yield* DateTime.nowAsDate;
              // The delivery ID and its attempt numbering continue across the
              // manual retry: the worker's next claim creates the next attempt
              // row, so no duplicate delivery row and no attempt-number
              // collision with the exhausted attempts.
              yield* db
                .update(schema.integrationDeliveryTable)
                .set({
                  exhaustedAt: null,
                  nextAttemptAt: now,
                  state: "pending",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(schema.integrationDeliveryTable.id, input.deliveryId),
                    eq(
                      schema.integrationDeliveryTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.integrationDeliveryTable.state, "exhausted")
                  )
                );
            })
          )
          .pipe(mapManagementError("manual retry"));
      }
    );

    return {
      createEndpoint,
      getDeliveryHistory,
      listEndpoints,
      pauseEndpoint,
      removeEndpoint,
      resumeEndpoint,
      retryDelivery,
      rotateSecret,
      sendTestDelivery,
      updateEndpoint,
    };
  })
);
