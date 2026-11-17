import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { AuditLogEnabled } from "@feeblo/domain/audit-log/flag";
import { WebhookIntegrationConfig } from "@feeblo/domain/integration/config";
import {
  WebhookDeliveryHistoryPage,
  WebhookEndpoint,
} from "@feeblo/domain/integration/schema";
import { WebhookManagementService } from "@feeblo/domain/integration/webhook-management-service";
import {
  CurrentSession,
  type Session,
} from "@feeblo/domain/session-middleware";
import { IntegrationConnectionId, WorkspaceId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { WebhookManagementServiceLive } from "./webhook-management-live";
import { WebhookManagementRpcHandlersEffect } from "./webhook-rpc-handlers";

const sessionFor = (
  organizationId: string,
  role: "admin" | "contributor"
): Session => ({
  organizations: [{ id: organizationId }],
  memberships: [
    { membershipId: `member_${organizationId}`, organizationId, role },
  ],
  session: { token: "test-token", userId: "user_test" },
  user: {
    email: "test@example.com",
    id: "user_test",
    name: "Test User",
    restrictedToOrganizationId: null,
  },
});

describe("WebhookManagementRpcHandlers", () => {
  it.effect(
    "permits admins, denies members, and forwards the requested organization unchanged",
    () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const connectionId = yield* IntegrationConnectionId.generate;
        const forwardedOrganizationIds: string[] = [];

        const endpoint = {
          eventTypes: ["post.created"] as const,
          health: "healthy" as const,
          hostname: "hooks.example.test",
          id: connectionId,
          lastFailedAt: null,
          lastSucceededAt: null,
          lifecycle: "active" as const,
          name: "Test endpoint",
        };

        const service = WebhookManagementService.of({
          createEndpoint: () => Effect.die("not used"),
          getDeliveryHistory: () => Effect.die("not used"),
          listEndpoints: ({ organizationId: forwardedOrganizationId }) =>
            Effect.sync(() =>
              forwardedOrganizationIds.push(forwardedOrganizationId)
            ).pipe(Effect.as([endpoint])),
          pauseEndpoint: () => Effect.die("not used"),
          removeEndpoint: () => Effect.die("not used"),
          resumeEndpoint: () => Effect.die("not used"),
          retryDelivery: () => Effect.die("not used"),
          rotateSecret: () => Effect.die("not used"),
          sendTestDelivery: () => Effect.die("not used"),
          updateEndpoint: () => Effect.die("not used"),
        });

        const handlers = yield* WebhookManagementRpcHandlersEffect.pipe(
          Effect.provideService(WebhookManagementService, service)
        );

        const allowed = yield* handlers
          .ListWebhookEndpoints({ organizationId })
          .pipe(
            Effect.provideService(
              CurrentSession,
              sessionFor(organizationId, "admin")
            )
          );

        expect(allowed).toEqual([endpoint]);
        expect(forwardedOrganizationIds).toEqual([organizationId]);

        const denied = yield* Effect.flip(
          handlers
            .ListWebhookEndpoints({ organizationId })
            .pipe(
              Effect.provideService(
                CurrentSession,
                sessionFor(organizationId, "contributor")
              )
            )
        );

        expect(denied._tag).toBe("PolicyDenied");
        expect(forwardedOrganizationIds).toEqual([organizationId]);
      })
  );

  it.effect(
    "denies a cross-organization list before the management service is called",
    () =>
      Effect.gen(function* () {
        const allowedOrganizationId = yield* WorkspaceId.generate;
        const foreignOrganizationId = yield* WorkspaceId.generate;
        const calls: string[] = [];

        const service = WebhookManagementService.of({
          createEndpoint: () => Effect.die("not used"),
          getDeliveryHistory: () => Effect.die("not used"),
          listEndpoints: ({ organizationId }) =>
            Effect.sync(() => calls.push(organizationId)).pipe(Effect.as([])),
          pauseEndpoint: () => Effect.die("not used"),
          removeEndpoint: () => Effect.die("not used"),
          resumeEndpoint: () => Effect.die("not used"),
          retryDelivery: () => Effect.die("not used"),
          rotateSecret: () => Effect.die("not used"),
          sendTestDelivery: () => Effect.die("not used"),
          updateEndpoint: () => Effect.die("not used"),
        });

        const handlers = yield* WebhookManagementRpcHandlersEffect.pipe(
          Effect.provideService(WebhookManagementService, service)
        );

        const error = yield* Effect.flip(
          handlers
            .ListWebhookEndpoints({ organizationId: foreignOrganizationId })
            .pipe(
              Effect.provideService(
                CurrentSession,
                sessionFor(allowedOrganizationId, "admin")
              )
            )
        );

        expect(error._tag).toBe("PolicyDenied");
        expect(calls).toEqual([]);
      })
  );

  it("decodes endpoint and history reads without credential-bearing fields", () => {
    const endpoint = Schema.decodeUnknownSync(WebhookEndpoint)({
      endpointUrl: "https://secret.example.test/hook",
      eventTypes: ["post.created"],
      health: "healthy",
      hostname: "hooks.example.test",
      id: "inc_safe",
      lastFailedAt: null,
      lastSucceededAt: null,
      lifecycle: "active",
      name: "Safe",
      signingSecret: "whsec_secret",
    });

    expect(endpoint).not.toHaveProperty("endpointUrl");
    expect(endpoint).not.toHaveProperty("signingSecret");
    expect(
      Schema.decodeSync(WebhookDeliveryHistoryPage)({
        items: [],
        nextCursor: null,
      })
    ).toEqual({ items: [], nextCursor: null });
  });

  it("decodes in-progress attempts with a null retry decision", () => {
    const page = Schema.decodeSync(WebhookDeliveryHistoryPage)({
      items: [
        {
          attempts: [
            {
              completedAt: null,
              durationMs: null,
              errorTag: null,
              httpStatus: null,
              id: "ida_in_progress",
              retryDecision: null,
              startedAt: "2026-08-11T00:00:00.000Z",
            },
            {
              completedAt: "2026-08-11T00:00:05.000Z",
              durationMs: 5000,
              errorTag: "IntegrationProviderTemporaryFailure",
              httpStatus: 503,
              id: "ida_completed",
              retryDecision: "retry",
              startedAt: "2026-08-11T00:00:00.000Z",
            },
          ],
          attemptCount: 1,
          createdAt: "2026-08-11T00:00:00.000Z",
          eventType: "webhook.test",
          id: "idl_1",
          nextAttemptAt: "2026-08-11T00:00:00.000Z",
          routeId: "irt_1",
          state: "leased",
        },
      ],
      nextCursor: null,
    });

    expect(page.items[0]?.attempts[0]?.retryDecision).toBeNull();
    expect(page.items[0]?.attempts[1]?.retryDecision).toBe("retry");
  });
});

/**
 * The audit test runs the real management service: the entry is written by the
 * service inside the transaction that creates the endpoint, not by the handler,
 * so a stubbed service could not prove it.
 */
const AuditTestLayer = Layer.mergeAll(
  WebhookManagementServiceLive.pipe(
    Layer.provide(
      Layer.succeed(
        WebhookIntegrationConfig,
        WebhookIntegrationConfig.of({
          encryptionKey: Redacted.make("0123456789abcdef0123456789abcdef"),
          endpointSecurityPolicy: {
            allowPrivateNetworkInDevelopment: true,
            environment: "development",
          },
        })
      )
    ),
    Layer.provide(Database.PgliteDatabaseLive)
  ),
  Database.PgliteDatabaseLive,
  NodeCrypto.layer
);

describe("WebhookManagementRpcHandlers audit", () => {
  layer(AuditTestLayer)("writing", (it) => {
    it.effect(
      "records the endpoint creation against the admin who made it, without the secret",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = yield* WorkspaceId.generate;
          yield* db.insert(schema.organizationTable).values({
            createdAt: yield* DateTime.nowAsDate,
            id: organizationId,
            name: "Webhook audit test",
            slug: organizationId,
          });
          const handlers = yield* WebhookManagementRpcHandlersEffect;

          const created = yield* handlers
            .CreateWebhookEndpoint({
              endpointUrl: "https://127.0.0.1:8080/hook",
              eventTypes: ["post.created"],
              name: "Product events",
              organizationId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                sessionFor(organizationId, "admin")
              ),
              Effect.provideService(AuditLogEnabled, true)
            );

          const rows = yield* db
            .select()
            .from(schema.auditLogTable)
            .where(
              and(
                eq(schema.auditLogTable.organizationId, organizationId),
                eq(schema.auditLogTable.action, "webhook.created")
              )
            );

          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            actorRole: "admin",
            actorType: "user",
            actorUserId: "user_test",
            outcome: "allowed",
            resourceId: created.endpoint.id,
            resourceType: "webhook",
            source: "dashboard",
          });
          expect(rows[0]?.metadata).toMatchObject({
            hostname: "127.0.0.1",
            name: "Product events",
          });
          // The one-time signing secret handed to the operator is the only
          // credential this action returns, and the entry must not repeat it.
          expect(
            JSON.stringify({
              changes: rows[0]?.changes,
              metadata: rows[0]?.metadata,
            })
          ).not.toContain(created.signingSecret);
        })
    );

    it.effect(
      "names a path-only destination change without recording either URL",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = yield* WorkspaceId.generate;
          yield* db.insert(schema.organizationTable).values({
            createdAt: yield* DateTime.nowAsDate,
            id: organizationId,
            name: "Webhook audit test",
            slug: organizationId,
          });
          const handlers = yield* WebhookManagementRpcHandlersEffect;
          const audited = Effect.provideService(AuditLogEnabled, true);

          const withSession = Effect.provideService(
            CurrentSession,
            sessionFor(organizationId, "admin")
          );

          const created = yield* handlers
            .CreateWebhookEndpoint({
              endpointUrl: "https://127.0.0.1:8080/hook",
              eventTypes: ["post.created"],
              name: "Product events",
              organizationId,
            })
            .pipe(withSession, audited);

          yield* handlers
            .UpdateWebhookEndpoint({
              connectionId: created.endpoint.id,
              endpointUrl: "https://127.0.0.1:8080/another-path",
              organizationId,
            })
            .pipe(withSession, audited);

          const rows = yield* db
            .select()
            .from(schema.auditLogTable)
            .where(
              and(
                eq(schema.auditLogTable.organizationId, organizationId),
                eq(schema.auditLogTable.action, "webhook.updated")
              )
            );

          expect(rows).toHaveLength(1);
          // The hostname did not move, so only the destination marker says the
          // endpoint changed at all.
          expect(rows[0]?.changes).toMatchObject({
            fields: ["destination"],
          });
          // Neither URL is stored: the hostname names the endpoint, and a path
          // can carry a per-endpoint token.
          const stored = JSON.stringify(rows[0]);
          expect(stored).not.toContain("/another-path");
          expect(stored).not.toContain("https://127.0.0.1:8080/hook");
        })
    );
  });
});
