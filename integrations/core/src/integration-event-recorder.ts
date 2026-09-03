import { currentDb, schema } from "@feeblo/db";
import { IntegrationDeliveryId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpTraceContext from "effect/unstable/http/HttpTraceContext";

import {
  IntegrationCapabilityKey,
  IntegrationConnectionLifecycleStatus,
  type IntegrationEventEnvelopeV1,
  IntegrationEventRecorder,
  type IntegrationEventRecorderContract,
  IntegrationEventRecordingError,
  IntegrationProviderKey,
  IntegrationRouteEventSelection,
} from "./integration-contracts";
import { doesIntegrationRouteMatchEvent } from "./route-event-selection";

const StoredRouteSelection = Schema.Struct({
  connectionId: Schema.String,
  connectionLifecycle: IntegrationConnectionLifecycleStatus,
  capabilityKey: IntegrationCapabilityKey,
  enabled: Schema.Boolean,
  eventTypes: IntegrationRouteEventSelection,
  id: Schema.String,
  provider: IntegrationProviderKey,
});

/** Records matched event deliveries in the caller's database transaction only. */
const makeIntegrationEventRecorder = Effect.gen(function* () {
  const db = yield* currentDb;
  const recordIntegrationEvent = Effect.fn(
    "IntegrationEventRecorder.recordIntegrationEvent"
  )(function* ({ event }: { readonly event: IntegrationEventEnvelopeV1 }) {
    const selections = yield* db
      .select({
        connectionId: schema.integrationConnectionTable.id,
        connectionLifecycle: schema.integrationConnectionTable.lifecycle,
        capabilityKey: schema.integrationRouteTable.capabilityKey,
        enabled: schema.integrationRouteTable.enabled,
        eventTypes: schema.integrationRouteTable.eventTypes,
        id: schema.integrationRouteTable.id,
        provider: schema.integrationConnectionTable.provider,
      })
      .from(schema.integrationRouteTable)
      .innerJoin(
        schema.integrationConnectionTable,
        eq(
          schema.integrationRouteTable.connectionId,
          schema.integrationConnectionTable.id
        )
      )
      .where(
        and(
          eq(schema.integrationRouteTable.organizationId, event.organizationId),
          eq(
            schema.integrationConnectionTable.organizationId,
            event.organizationId
          )
        )
      );
    const routes = yield* Effect.forEach(selections, (selection) =>
      Schema.decodeUnknownEffect(StoredRouteSelection)(selection).pipe(
        Effect.mapError(
          () =>
            new IntegrationEventRecordingError({
              message: "Stored integration route selection is invalid",
            })
        )
      )
    );
    const matched = routes.filter((route) =>
      doesIntegrationRouteMatchEvent({
        connectionLifecycleStatus: route.connectionLifecycle,
        event,
        route,
      })
    );
    if (matched.length === 0) {
      return { deliveryCount: 0, eventRecorded: false };
    }
    const now = yield* DateTime.now;
    const occurredAt = DateTime.toDate(event.occurredAt);
    const retentionExpiresAt = DateTime.toDate(
      DateTime.addDuration(now, Duration.days(30))
    );
    // Persist the recording request's W3C trace context so the async delivery
    // worker can link its spans back to the originating trace. Optional: spans
    // may be absent (e.g. unsampled or provider-triggered ingresses).
    const originTraceparent = yield* Effect.currentSpan.pipe(
      Effect.option,
      Effect.map(
        Option.match({
          onNone: () => undefined,
          onSome: (span) => HttpTraceContext.toHeaders(span).traceparent,
        })
      )
    );
    yield* db.insert(schema.integrationEventTable).values({
      causalHopCount: event.causalHopCount,
      causationId: event.causationId ?? null,
      correlationId: event.correlationId,
      id: event.id,
      occurredAt,
      organizationId: event.organizationId,
      origin: {
        ...event.origin,
        ...(originTraceparent !== undefined && {
          traceparent: originTraceparent,
        }),
      },
      payload: event.data,
      retentionExpiresAt,
      type: event.type,
      version: event.version,
    });
    yield* Effect.forEach(matched, (route) =>
      Effect.gen(function* () {
        const id = yield* IntegrationDeliveryId.generate;
        yield* db.insert(schema.integrationDeliveryTable).values({
          actionKey: `${event.id}:${route.id}`,
          connectionId: route.connectionId,
          eventId: event.id,
          id,
          nextAttemptAt: DateTime.toDate(now),
          organizationId: event.organizationId,
          retentionExpiresAt,
          routeId: route.id,
          state: "pending",
        });
      })
    );
    return { deliveryCount: matched.length, eventRecorded: true };
  });
  return {
    recordIntegrationEvent: (input) =>
      recordIntegrationEvent(input).pipe(
        Effect.withSpan("IntegrationEventRecorder.record", {
          attributes: {
            "integration.correlation_id": input.event.correlationId,
            "integration.event_id": input.event.id,
            "integration.event_type": input.event.type,
            "integration.organization_id": input.event.organizationId,
          },
        }),
        Effect.mapError(
          () =>
            new IntegrationEventRecordingError({
              message: "Could not record integration event",
            })
        )
      ),
  } satisfies IntegrationEventRecorderContract;
});

/** Live transaction-bound event recorder; callers provide the surrounding transaction. */
export const IntegrationEventRecorderLive = Layer.effect(
  IntegrationEventRecorder,
  makeIntegrationEventRecorder
);
