import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  IntegrationDeliveryId,
  IntegrationEventId,
  type LegidOf,
  WorkspaceId,
} from "@feeblo/id";
import { decryptWebhookCredentialMaterial } from "./index";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { WebhookIntegrationConfig } from "@feeblo/domain/integration/config";
import { WebhookManagementServiceLive } from "./webhook-management-live";
import { WebhookManagementService } from "@feeblo/domain/integration/webhook-management-service";

/** Single configuration source for the service tests: shared encryption key and the default policy. */
const webhookTestConfig = {
  allowPrivateNetworkInDevelopment: true,
  encryptionKey: Redacted.make("0123456789abcdef0123456789abcdef"),
  environment: "development",
} as const;

const testConfigLayer = (policy: {
  readonly allowPrivateNetworkInDevelopment: boolean;
  readonly environment: "development" | "production" | "test";
}) =>
  Layer.succeed(
    WebhookIntegrationConfig,
    WebhookIntegrationConfig.of({
      encryptionKey: webhookTestConfig.encryptionKey,
      endpointSecurityPolicy: policy,
    })
  );

const TestLayer = Layer.mergeAll(
  WebhookManagementServiceLive.pipe(
    Layer.provide(
      testConfigLayer({
        allowPrivateNetworkInDevelopment:
          webhookTestConfig.allowPrivateNetworkInDevelopment,
        environment: webhookTestConfig.environment,
      })
    ),
    Layer.provide(Database.PgliteDatabaseLive)
  ),
  Database.PgliteDatabaseLive,
  NodeCrypto.layer
);

const ProductionPolicyTestLayer = Layer.mergeAll(
  WebhookManagementServiceLive.pipe(
    Layer.provide(
      testConfigLayer({
        allowPrivateNetworkInDevelopment: false,
        environment: "production",
      })
    ),
    Layer.provide(Database.PgliteDatabaseLive)
  ),
  Database.PgliteDatabaseLive,
  NodeCrypto.layer
);

const seedOrganization = Effect.gen(function* () {
  const db = yield* currentDb;
  const organizationId = yield* WorkspaceId.generate;
  yield* db.insert(schema.organizationTable).values({
    createdAt: new Date(),
    id: organizationId,
    name: "Webhook management test",
    slug: organizationId,
  });
  return organizationId;
});

const signingSecretPattern = /^whsec_/;

const createEndpointInput = (
  organizationId: LegidOf<"WorkspaceId">,
  endpointUrl: string
) => ({
  endpointUrl,
  eventTypes: ["feedback.post.created"] as const,
  name: "Product events",
  organizationId,
});

describe("webhook management service", () => {
  layer(ProductionPolicyTestLayer)("production egress policy", (it) => {
    it.effect(
      "rejects a private endpoint URL under the production egress policy",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = yield* seedOrganization;
          const service = yield* WebhookManagementService;
          const error = yield* Effect.flip(
            service.createEndpoint(
              createEndpointInput(organizationId, "http://127.0.0.1:8080/hook")
            )
          );
          expect(error._tag).toBe("BadRequestError");
          expect(
            yield* db
              .select()
              .from(schema.integrationConnectionTable)
              .where(
                eq(
                  schema.integrationConnectionTable.organizationId,
                  organizationId
                )
              )
          ).toHaveLength(0);
        })
    );
  });

  layer(TestLayer)("endpoint lifecycle", (it) => {
    it.effect(
      "creates an endpoint with encrypted credentials and a one-time signing secret",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* WebhookManagementService;
          const organizationId = yield* seedOrganization;
          const endpointUrl = "https://127.0.0.1:8080/hook";

          const created = yield* service.createEndpoint(
            createEndpointInput(organizationId, endpointUrl)
          );

          expect(created.signingSecret).toMatch(signingSecretPattern);
          expect(created.endpoint).toMatchObject({
            eventTypes: ["feedback.post.created"],
            health: "healthy",
            hostname: "127.0.0.1",
            lifecycle: "active",
            name: "Product events",
          });

          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, created.endpoint.id)
            );
          expect(connection?.credentialsCiphertext).not.toContain(endpointUrl);
          expect(connection?.lifecycle).toBe("active");
          expect(connection?.credentialGeneration).toBe(1);

          const [route] = yield* db
            .select()
            .from(schema.integrationRouteTable)
            .where(
              eq(schema.integrationRouteTable.connectionId, created.endpoint.id)
            );
          expect(route?.enabled).toBe(true);
          expect(route?.eventTypes).toEqual(["feedback.post.created"]);

          const listed = yield* service.listEndpoints({ organizationId });
          expect(listed).toHaveLength(1);
          expect(listed[0]).toMatchObject({
            id: created.endpoint.id,
            health: "healthy",
            hostname: "127.0.0.1",
            lifecycle: "active",
          });
        })
    );

    it.effect(
      "updates name, event selection, and endpoint URL while preserving the signing keyring",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* WebhookManagementService;
          const organizationId = yield* seedOrganization;
          const created = yield* service.createEndpoint(
            createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
          );

          const updated = yield* service.updateEndpoint({
            connectionId: created.endpoint.id,
            endpointUrl: "https://127.0.0.1:8080/moved",
            eventTypes: ["feedback.post.status_changed"],
            name: "Renamed endpoint",
            organizationId,
          });
          expect(updated.name).toBe("Renamed endpoint");
          expect(updated.eventTypes).toEqual(["feedback.post.status_changed"]);
          expect(updated.hostname).toBe("127.0.0.1");

          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, created.endpoint.id)
            );
          expect(connection?.credentialsCiphertext).not.toContain(
            "127.0.0.1:8080/moved"
          );
          expect(connection?.safeDisplayMetadata).toEqual({
            hostname: "127.0.0.1",
          });

          const decrypted = yield* decryptWebhookCredentialMaterial(
            webhookTestConfig.encryptionKey,
            connection?.credentialsCiphertext ?? ""
          );
          expect(Redacted.value(decrypted.endpointUrl)).toBe(
            "https://127.0.0.1:8080/moved"
          );
          expect(Redacted.value(decrypted.signingKeyring.current)).toBe(
            created.signingSecret
          );

          const [route] = yield* db
            .select()
            .from(schema.integrationRouteTable)
            .where(
              eq(schema.integrationRouteTable.connectionId, created.endpoint.id)
            );
          expect(route?.eventTypes).toEqual(["feedback.post.status_changed"]);
        })
    );

    it.effect(
      "pauses a connection, disables its route, and cancels queued deliveries",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* WebhookManagementService;
          const organizationId = yield* seedOrganization;
          const created = yield* service.createEndpoint(
            createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
          );
          const [storedRoute] = yield* db
            .select({ id: schema.integrationRouteTable.id })
            .from(schema.integrationRouteTable)
            .where(
              eq(schema.integrationRouteTable.connectionId, created.endpoint.id)
            );
          const deliveryId = yield* IntegrationDeliveryId.generate;
          const eventId = yield* IntegrationEventId.generate;
          const now = new Date();
          yield* db.insert(schema.integrationEventTable).values({
            causalHopCount: 0,
            correlationId: eventId,
            id: eventId,
            occurredAt: now,
            organizationId,
            origin: { kind: "feeblo" },
            payload: {},
            retentionExpiresAt: new Date(now.getTime() + 86_400_000),
            type: "webhook.test",
            version: 1,
          });
          yield* db.insert(schema.integrationDeliveryTable).values({
            actionKey: `webhook.test:${created.endpoint.id}`,
            connectionId: created.endpoint.id,
            eventId,
            id: deliveryId,
            nextAttemptAt: now,
            organizationId,
            retentionExpiresAt: new Date(now.getTime() + 86_400_000),
            routeId: storedRoute?.id ?? "",
            state: "pending",
          });

          yield* service.pauseEndpoint({
            connectionId: created.endpoint.id,
            organizationId,
          });

          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, created.endpoint.id)
            );
          expect(connection?.lifecycle).toBe("paused");
          const [route] = yield* db
            .select()
            .from(schema.integrationRouteTable)
            .where(
              eq(schema.integrationRouteTable.connectionId, created.endpoint.id)
            );
          expect(route?.enabled).toBe(false);
          const [delivery] = yield* db
            .select()
            .from(schema.integrationDeliveryTable)
            .where(eq(schema.integrationDeliveryTable.id, deliveryId));
          expect(delivery?.state).toBe("canceled");

          yield* service.resumeEndpoint({
            connectionId: created.endpoint.id,
            organizationId,
          });
          const [resumed] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, created.endpoint.id)
            );
          expect(resumed?.lifecycle).toBe("active");
          const [enabledRoute] = yield* db
            .select()
            .from(schema.integrationRouteTable)
            .where(
              eq(schema.integrationRouteTable.connectionId, created.endpoint.id)
            );
          expect(enabledRoute?.enabled).toBe(true);
        })
    );

    it.effect(
      "rotates the signing secret and retains the previous key for the grace period",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* WebhookManagementService;
          const organizationId = yield* seedOrganization;
          const created = yield* service.createEndpoint(
            createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
          );

          const rotated = yield* service.rotateSecret({
            connectionId: created.endpoint.id,
            organizationId,
          });
          expect(rotated.signingSecret).toMatch(signingSecretPattern);
          expect(rotated.signingSecret).not.toBe(created.signingSecret);

          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, created.endpoint.id)
            );
          expect(connection?.credentialGeneration).toBe(2);
          const decrypted = yield* decryptWebhookCredentialMaterial(
            webhookTestConfig.encryptionKey,
            connection?.credentialsCiphertext ?? ""
          );
          expect(Redacted.value(decrypted.signingKeyring.current)).toBe(
            rotated.signingSecret
          );
          expect(
            Redacted.value(
              decrypted.signingKeyring.previous?.secret ?? Redacted.make("")
            )
          ).toBe(created.signingSecret);
        })
    );

    it.effect("rotates the signing secret of a paused endpoint", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* WebhookManagementService;
        const organizationId = yield* seedOrganization;
        const created = yield* service.createEndpoint(
          createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
        );
        yield* service.pauseEndpoint({
          connectionId: created.endpoint.id,
          organizationId,
        });

        const rotated = yield* service.rotateSecret({
          connectionId: created.endpoint.id,
          organizationId,
        });
        expect(rotated.signingSecret).toMatch(signingSecretPattern);

        const [connection] = yield* db
          .select()
          .from(schema.integrationConnectionTable)
          .where(eq(schema.integrationConnectionTable.id, created.endpoint.id));
        expect(connection?.lifecycle).toBe("paused");
        expect(connection?.credentialGeneration).toBe(2);
        const decrypted = yield* decryptWebhookCredentialMaterial(
          webhookTestConfig.encryptionKey,
          connection?.credentialsCiphertext ?? ""
        );
        expect(Redacted.value(decrypted.signingKeyring.current)).toBe(
          rotated.signingSecret
        );
      })
    );

    it.effect(
      "removes an endpoint, scrubs its ciphertext, and cancels pending work",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* WebhookManagementService;
          const organizationId = yield* seedOrganization;
          const created = yield* service.createEndpoint(
            createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
          );

          yield* service.removeEndpoint({
            connectionId: created.endpoint.id,
            organizationId,
          });

          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, created.endpoint.id)
            );
          expect(connection?.lifecycle).toBe("archived");
          expect(connection?.credentialsCiphertext).toBeNull();
          expect(connection?.archivedAt).not.toBeNull();

          const listed = yield* service.listEndpoints({ organizationId });
          expect(listed).toHaveLength(0);
        })
    );

    it.effect("scopes every operation to the owning organization", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* WebhookManagementService;
        const organizationId = yield* seedOrganization;
        const foreignOrganizationId = yield* seedOrganization;
        const created = yield* service.createEndpoint(
          createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
        );

        const listed = yield* service.listEndpoints({
          organizationId: foreignOrganizationId,
        });
        expect(listed).toHaveLength(0);

        const notFound = yield* Effect.flip(
          service.updateEndpoint({
            connectionId: created.endpoint.id,
            name: "Foreign rename",
            organizationId: foreignOrganizationId,
          })
        );
        expect(notFound._tag).toBe("NotFoundError");

        const pauseError = yield* Effect.flip(
          service.pauseEndpoint({
            connectionId: created.endpoint.id,
            organizationId: foreignOrganizationId,
          })
        );
        expect(pauseError._tag).toBe("NotFoundError");

        const [connection] = yield* db
          .select()
          .from(schema.integrationConnectionTable)
          .where(eq(schema.integrationConnectionTable.id, created.endpoint.id));
        expect(connection?.lifecycle).toBe("active");
      })
    );
  });

  layer(TestLayer)("test deliveries and history", (it) => {
    it.effect(
      "queues a synthetic test delivery that appears in history with its attempt",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* WebhookManagementService;
          const organizationId = yield* seedOrganization;
          const created = yield* service.createEndpoint(
            createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
          );

          const queued = yield* service.sendTestDelivery({
            connectionId: created.endpoint.id,
            organizationId,
          });
          expect(queued.result).toBe("queued");

          const [delivery] = yield* db
            .select()
            .from(schema.integrationDeliveryTable)
            .where(eq(schema.integrationDeliveryTable.id, queued.deliveryId));
          expect(delivery?.state).toBe("pending");
          expect(delivery?.connectionId).toBe(created.endpoint.id);

          const history = yield* service.getDeliveryHistory({
            connectionId: created.endpoint.id,
            organizationId,
          });
          expect(history.items).toHaveLength(1);
          expect(history.nextCursor).toBeNull();
          expect(history.items[0]).toMatchObject({
            eventType: "webhook.test",
            id: queued.deliveryId,
            state: "pending",
            attempts: [],
          });
        })
    );

    it.effect(
      "pages history with a stable keyset cursor when timestamps collide",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* WebhookManagementService;
          const organizationId = yield* seedOrganization;
          const created = yield* service.createEndpoint(
            createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
          );
          const first = yield* service.sendTestDelivery({
            connectionId: created.endpoint.id,
            organizationId,
          });
          const second = yield* service.sendTestDelivery({
            connectionId: created.endpoint.id,
            organizationId,
          });
          // Force identical creation timestamps so the cursor must disambiguate
          // by delivery ID rather than by time alone.
          const sameTime = new Date("2026-08-11T00:00:00.000Z");
          yield* db
            .update(schema.integrationDeliveryTable)
            .set({ createdAt: sameTime })
            .where(eq(schema.integrationDeliveryTable.id, first.deliveryId));
          yield* db
            .update(schema.integrationDeliveryTable)
            .set({ createdAt: sameTime })
            .where(eq(schema.integrationDeliveryTable.id, second.deliveryId));

          const pageOne = yield* service.getDeliveryHistory({
            connectionId: created.endpoint.id,
            limit: 1,
            organizationId,
          });
          expect(pageOne.items).toHaveLength(1);
          expect(pageOne.nextCursor).not.toBeNull();

          const pageTwo = yield* service.getDeliveryHistory({
            connectionId: created.endpoint.id,
            ...(pageOne.nextCursor !== null && { cursor: pageOne.nextCursor }),
            limit: 1,
            organizationId,
          });
          expect(pageTwo.items).toHaveLength(1);
          expect(pageTwo.nextCursor).toBeNull();

          const seenIds = [pageOne.items[0]?.id, pageTwo.items[0]?.id].sort();
          expect(seenIds).toEqual([first.deliveryId, second.deliveryId].sort());

          const malformed = yield* Effect.flip(
            service.getDeliveryHistory({
              connectionId: created.endpoint.id,
              cursor: "not-a-cursor",
              organizationId,
            })
          );
          expect(malformed._tag).toBe("BadRequestError");
        })
    );

    it.effect("retries only exhausted deliveries of an active endpoint", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* WebhookManagementService;
        const organizationId = yield* seedOrganization;
        const created = yield* service.createEndpoint(
          createEndpointInput(organizationId, "https://127.0.0.1:8080/hook")
        );
        const queued = yield* service.sendTestDelivery({
          connectionId: created.endpoint.id,
          organizationId,
        });

        const notExhausted = yield* Effect.flip(
          service.retryDelivery({
            deliveryId: queued.deliveryId,
            organizationId,
          })
        );
        expect(notExhausted._tag).toBe("NotFoundError");

        const now = new Date();
        yield* db
          .update(schema.integrationDeliveryTable)
          .set({
            exhaustedAt: now,
            state: "exhausted",
            updatedAt: now,
          })
          .where(eq(schema.integrationDeliveryTable.id, queued.deliveryId));

        yield* service.retryDelivery({
          deliveryId: queued.deliveryId,
          organizationId,
        });
        const [retried] = yield* db
          .select()
          .from(schema.integrationDeliveryTable)
          .where(eq(schema.integrationDeliveryTable.id, queued.deliveryId));
        expect(retried?.state).toBe("pending");
        expect(retried?.exhaustedAt).toBeNull();
        expect(retried?.attemptCount).toBe(0);

        // A paused endpoint refuses manual retries. Exhaust a second
        // delivery before pausing: pausing cancels pending work, but an
        // exhausted delivery is already terminal and stays retryable.
        const pausedTarget = yield* service.sendTestDelivery({
          connectionId: created.endpoint.id,
          organizationId,
        });
        yield* db
          .update(schema.integrationDeliveryTable)
          .set({ exhaustedAt: now, state: "exhausted", updatedAt: now })
          .where(
            eq(schema.integrationDeliveryTable.id, pausedTarget.deliveryId)
          );
        yield* service.pauseEndpoint({
          connectionId: created.endpoint.id,
          organizationId,
        });
        const pausedError = yield* Effect.flip(
          service.retryDelivery({
            deliveryId: pausedTarget.deliveryId,
            organizationId,
          })
        );
        expect(pausedError._tag).toBe("BadRequestError");
      })
    );
  });
});
