import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema, transaction } from "@feeblo/db";
import {
  BoardId,
  IntegrationConnectionId,
  IntegrationEventId,
  IntegrationRouteId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  IntegrationEventRecorder,
  IntegrationProviderKey,
} from "./integration-contracts";
import { makeIntegrationDeliveryWorkerRepository } from "./integration-delivery-postgres-repository";
import { IntegrationEventRecorderLive } from "./integration-event-recorder";

const TestLayer = IntegrationEventRecorderLive.pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

const seedRoute = Effect.gen(function* () {
  const db = yield* currentDb;
  const organizationId = yield* WorkspaceId.generate;
  const connectionId = yield* IntegrationConnectionId.generate;
  const routeId = yield* IntegrationRouteId.generate;
  yield* db.insert(schema.organizationTable).values({
    createdAt: new Date(),
    id: organizationId,
    name: "Integration persistence test",
    slug: organizationId,
  });
  yield* db.insert(schema.integrationConnectionTable).values({
    credentialGeneration: 1,
    credentialsCiphertext: "encrypted-test-value",
    id: connectionId,
    lifecycle: "active",
    name: "Test endpoint",
    organizationId,
    provider: IntegrationProviderKey.make("webhook"),
    safeDisplayMetadata: { hostname: "example.com" },
  });
  yield* db.insert(schema.integrationRouteTable).values({
    capabilityKey: "events.post",
    configVersion: 1,
    connectionId,
    enabled: true,
    eventTypes: ["feedback.post.created"],
    id: routeId,
    organizationId,
    providerConfig: {},
    safeDisplayMetadata: {},
  });
  return { connectionId, organizationId, routeId };
});

const makePostCreatedEvent = Effect.gen(function* () {
  const id = yield* IntegrationEventId.generate;
  const organizationId = yield* WorkspaceId.generate;
  const boardId = yield* BoardId.generate;
  const postId = yield* PostId.generate;
  const statusId = yield* PostStatusId.generate;
  return {
    event: {
      causalHopCount: 0,
      correlationId: id,
      data: {
        actor: { kind: "end_user" as const },
        board: { id: boardId, name: "Feedback", slug: "feedback" },
        post: {
          id: postId,
          status: { id: statusId, type: "PENDING" },
          title: "Test post",
          url: "https://app.example.test/post/test",
        },
      },
      id,
      occurredAt: DateTime.makeUnsafe(new Date()),
      organizationId,
      origin: { kind: "feeblo" as const },
      type: "feedback.post.created" as const,
      version: 1 as const,
    },
  };
});

describe("integration persistence", () => {
  layer(TestLayer)("event recording and delivery leases", (it) => {
    it.effect(
      "rolls event and delivery fan-out back with the source transaction",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const recorder = yield* IntegrationEventRecorder;
          const route = yield* seedRoute;
          const input = yield* makePostCreatedEvent;
          const event = {
            ...input.event,
            organizationId: route.organizationId,
          };

          yield* Effect.flip(
            transaction(
              recorder
                .recordIntegrationEvent({ event })
                .pipe(
                  Effect.flatMap(() => Effect.fail("force-source-rollback"))
                )
            )
          );

          expect(
            yield* db
              .select()
              .from(schema.integrationEventTable)
              .where(eq(schema.integrationEventTable.id, event.id))
          ).toHaveLength(0);
          expect(
            yield* db
              .select()
              .from(schema.integrationDeliveryTable)
              .where(eq(schema.integrationDeliveryTable.eventId, event.id))
          ).toHaveLength(0);
        })
    );

    it.effect(
      "claims a decoded input and guards execution by the active lifecycle",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const recorder = yield* IntegrationEventRecorder;
          const repository = yield* makeIntegrationDeliveryWorkerRepository;
          const route = yield* seedRoute;
          const input = yield* makePostCreatedEvent;
          const event = {
            ...input.event,
            organizationId: route.organizationId,
          };
          yield* transaction(recorder.recordIntegrationEvent({ event }));

          const claimed = yield* repository.claimDueDeliveries({
            leaseDurationMs: 60_000,
            leaseOwner: "worker-a",
            limit: 10,
          });
          expect(claimed).toHaveLength(1);
          const delivery = claimed[0];
          expect(delivery?.input.event.id).toBe(event.id);
          expect(delivery?.input.connection.id).toBe(route.connectionId);
          expect(
            delivery &&
              (yield* repository.canExecuteClaimedDelivery({
                claimed: delivery,
              }))
          ).toBe(true);

          yield* db
            .update(schema.integrationConnectionTable)
            .set({ lifecycle: "paused" })
            .where(
              eq(schema.integrationConnectionTable.id, route.connectionId)
            );
          expect(
            delivery &&
              (yield* repository.canExecuteClaimedDelivery({
                claimed: delivery,
              }))
          ).toBe(false);
          if (delivery !== undefined) {
            yield* repository.cancelClaimedDelivery({ claimed: delivery });
            const [canceled] = yield* db
              .select()
              .from(schema.integrationDeliveryTable)
              .where(
                eq(
                  schema.integrationDeliveryTable.id,
                  delivery.input.delivery.id
                )
              );
            expect(canceled?.state).toBe("canceled");
            expect(canceled?.leaseOwner).toBeNull();
          }
        })
    );

    it.effect(
      "requeues expired leases and preserves the stable delivery ID",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const recorder = yield* IntegrationEventRecorder;
          const repository = yield* makeIntegrationDeliveryWorkerRepository;
          const route = yield* seedRoute;
          const input = yield* makePostCreatedEvent;
          const event = {
            ...input.event,
            organizationId: route.organizationId,
          };
          yield* transaction(recorder.recordIntegrationEvent({ event }));
          const [claimed] = yield* repository.claimDueDeliveries({
            leaseDurationMs: 60_000,
            leaseOwner: "worker-recovery",
            limit: 1,
          });
          expect(claimed).toBeDefined();
          if (claimed === undefined) {
            return;
          }
          yield* db
            .update(schema.integrationDeliveryTable)
            .set({
              leaseExpiresAt: new Date(0),
            })
            .where(
              eq(schema.integrationDeliveryTable.id, claimed.input.delivery.id)
            );

          yield* repository.recoverExpiredLeases();
          const [recovered] = yield* db
            .select()
            .from(schema.integrationDeliveryTable)
            .where(
              eq(schema.integrationDeliveryTable.id, claimed.input.delivery.id)
            );
          expect(recovered?.state).toBe("pending");
          expect(recovered?.leaseOwner).toBeNull();

          const [reclaimed] = yield* repository.claimDueDeliveries({
            leaseDurationMs: 60_000,
            leaseOwner: "worker-b",
            limit: 1,
          });
          expect(reclaimed?.input.delivery.id).toBe(claimed.input.delivery.id);
          expect(reclaimed?.input.delivery.attemptCount).toBe(2);
          if (reclaimed === undefined) {
            return;
          }
          yield* db
            .update(schema.integrationConnectionTable)
            .set({ lifecycle: "paused" })
            .where(
              eq(schema.integrationConnectionTable.id, route.connectionId)
            );
          yield* db
            .update(schema.integrationDeliveryTable)
            .set({ leaseExpiresAt: new Date(0) })
            .where(
              eq(
                schema.integrationDeliveryTable.id,
                reclaimed.input.delivery.id
              )
            );
          yield* repository.recoverExpiredLeases();
          const [canceledAfterRecovery] = yield* db
            .select()
            .from(schema.integrationDeliveryTable)
            .where(
              eq(
                schema.integrationDeliveryTable.id,
                reclaimed.input.delivery.id
              )
            );
          expect(canceledAfterRecovery?.state).toBe("canceled");
          expect(canceledAfterRecovery?.leaseOwner).toBeNull();
        })
    );

    it.effect(
      "rejects a stale owner acknowledgement and schedules retries on the stable delivery",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const recorder = yield* IntegrationEventRecorder;
          const repository = yield* makeIntegrationDeliveryWorkerRepository;
          const route = yield* seedRoute;
          const input = yield* makePostCreatedEvent;
          yield* transaction(
            recorder.recordIntegrationEvent({
              event: { ...input.event, organizationId: route.organizationId },
            })
          );
          const [claimed] = yield* repository.claimDueDeliveries({
            leaseDurationMs: 60_000,
            leaseOwner: "owner-a",
            limit: 1,
          });
          if (!claimed) {
            return;
          }
          yield* repository.persistDeliveryResult({
            claimed: { ...claimed, leaseOwner: "stale-owner" },
            outcome: { _tag: "Succeeded" },
          });
          let [row] = yield* db
            .select()
            .from(schema.integrationDeliveryTable)
            .where(
              eq(schema.integrationDeliveryTable.id, claimed.input.delivery.id)
            );
          expect(row?.state).toBe("leased");
          yield* repository.persistDeliveryResult({
            claimed,
            outcome: { _tag: "Retry" },
          });
          [row] = yield* db
            .select()
            .from(schema.integrationDeliveryTable)
            .where(
              eq(schema.integrationDeliveryTable.id, claimed.input.delivery.id)
            );
          expect(row?.id).toBe(claimed.input.delivery.id);
          expect(row?.state).toBe("pending");
          expect(row?.attemptCount).toBe(1);
        })
    );

    it.effect(
      "allows competing claimers to lease a pending delivery only once",
      () =>
        Effect.gen(function* () {
          const recorder = yield* IntegrationEventRecorder;
          const repository = yield* makeIntegrationDeliveryWorkerRepository;
          const route = yield* seedRoute;
          const input = yield* makePostCreatedEvent;
          yield* transaction(
            recorder.recordIntegrationEvent({
              event: { ...input.event, organizationId: route.organizationId },
            })
          );
          const [first, second] = yield* Effect.all(
            [
              repository.claimDueDeliveries({
                leaseDurationMs: 60_000,
                leaseOwner: "claimer-a",
                limit: 1,
              }),
              repository.claimDueDeliveries({
                leaseDurationMs: 60_000,
                leaseOwner: "claimer-b",
                limit: 1,
              }),
            ],
            { concurrency: "unbounded" }
          );
          expect(first.length + second.length).toBe(1);
        })
    );

    it.effect(
      "auto-pauses after ten exhausted deliveries and cancels pending work",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const recorder = yield* IntegrationEventRecorder;
          const repository = yield* makeIntegrationDeliveryWorkerRepository;
          const route = yield* seedRoute;
          for (let count = 0; count < 11; count++) {
            const input = yield* makePostCreatedEvent;
            yield* transaction(
              recorder.recordIntegrationEvent({
                event: { ...input.event, organizationId: route.organizationId },
              })
            );
          }
          for (let count = 0; count < 10; count++) {
            const [claimed] = yield* repository.claimDueDeliveries({
              leaseDurationMs: 60_000,
              leaseOwner: `exhaust-${count}`,
              limit: 1,
            });
            if (claimed === undefined) {
              return yield* Effect.die("Expected pending delivery");
            }
            yield* repository.persistDeliveryResult({
              claimed,
              outcome: { _tag: "Terminal" },
            });
          }
          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, route.connectionId)
            );
          const [storedRoute] = yield* db
            .select()
            .from(schema.integrationRouteTable)
            .where(eq(schema.integrationRouteTable.id, route.routeId));
          const pending = yield* db
            .select()
            .from(schema.integrationDeliveryTable)
            .where(
              eq(
                schema.integrationDeliveryTable.connectionId,
                route.connectionId
              )
            );
          expect(connection?.lifecycle).toBe("paused");
          expect(connection?.consecutiveExhaustedDeliveries).toBe(10);
          expect(storedRoute?.enabled).toBe(false);
          expect(
            pending.filter((delivery) => delivery.state === "canceled")
          ).toHaveLength(1);
        })
    );
  });
});
