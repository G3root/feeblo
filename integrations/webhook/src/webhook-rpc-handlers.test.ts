import { expect, layer } from "@effect/vitest";
import { Database } from "@feeblo/db";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import {
  WebhookDeliveryHistoryPage,
  WebhookEndpoint,
} from "@feeblo/domain/integration/schema";
import { WebhookManagementService } from "@feeblo/domain/integration/webhook-management-service";
import {
  CurrentSession,
  type Session,
} from "@feeblo/domain/session-middleware";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
import { IntegrationConnectionId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { WebhookManagementRpcHandlersEffect } from "./webhook-rpc-handlers";

/**
 * The real plan-lock policy over an empty PGlite database. The organizations
 * these tests use have no subscription and no members, so the lock resolves
 * free and writable, which is what the permission assertions need.
 */
const EntitlementPolicyTest = EntitlementPolicy.layer.pipe(
  Layer.provide(WorkspaceRepository.layer),
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

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

layer(EntitlementPolicyTest)("WebhookManagementRpcHandlers", (it) => {
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
      Schema.decodeUnknownSync(WebhookDeliveryHistoryPage)({
        items: [],
        nextCursor: null,
      })
    ).toEqual({ items: [], nextCursor: null });
  });

  it("decodes in-progress attempts with a null retry decision", () => {
    const page = Schema.decodeUnknownSync(WebhookDeliveryHistoryPage)({
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
