import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { DiscordManagementService } from "@feeblo/domain/integration/discord/management-service";
import {
  CurrentSession,
  type Session,
} from "@feeblo/domain/session-middleware";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DiscordManagementRpcHandlersEffect } from "./discord-rpc-handlers";

const TestLayer = Layer.mergeAll(
  Database.PgliteDatabaseLive,
  WorkspaceRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
  EntitlementPolicy.layer.pipe(
    Layer.provide(WorkspaceRepository.layer),
    Layer.provide(Database.PgliteDatabaseLive)
  )
);

const makeSession = (organizationId: string): Session => ({
  user: {
    id: `user_${organizationId}`,
    email: "owner@example.com",
    name: "Owner",
    restrictedToOrganizationId: null,
  },
  session: { userId: `user_${organizationId}`, token: "test-token" },
  organizations: [{ id: organizationId }],
  memberships: [
    {
      membershipId: `member_${organizationId}`,
      organizationId,
      role: "owner",
    },
  ],
});

/** Seeds an organization and optionally an entitled `starter` subscription. */
const seedWorkspace = Effect.fn("test.seedWorkspace")(function* (
  options: { readonly paid?: boolean } = {}
) {
  const db = yield* currentDb;
  const organizationId = yield* WorkspaceId.generate;
  const now = new Date();
  yield* db.insert(schema.organizationTable).values({
    id: organizationId,
    name: "Discord gate workspace",
    slug: organizationId,
    createdAt: now,
  });
  if (options.paid) {
    yield* db.insert(schema.productTable).values({
      id: `product_${organizationId}`,
      name: "Starter",
      isRecurring: true,
      isArchived: false,
      externalOrganizationId: "feeblo",
      visibility: "public",
      metadata: { plan: "starter", variant: "monthly" },
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.subscriptionTable).values({
      id: `subscription_${organizationId}`,
      externalId: `external_${organizationId}`,
      organizationId,
      amount: 2900,
      cancelAtPeriodEnd: false,
      currency: "usd",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 86_400_000),
      customerId: `customer_${organizationId}`,
      productId: `product_${organizationId}`,
    });
  }
  return organizationId;
});

/** Management service stub that records every forwarded connect request. */
const makeService = (calls: string[]) =>
  DiscordManagementService.of({
    connectComplete: () => Effect.die("not used"),
    connectStart: ({ organizationId }) =>
      Effect.sync(() => calls.push(organizationId)).pipe(
        Effect.as({
          authorizeUrl: new URL("https://discord.com/oauth2/authorize"),
        })
      ),
    disconnect: () => Effect.die("not used"),
    listChannels: () => Effect.die("not used"),
    listConnections: () => Effect.die("not used"),
    setChannelNotifications: () => Effect.die("not used"),
    status: () => Effect.succeed({ configured: true }),
  });

describe("DiscordManagementRpcHandlers", () => {
  layer(TestLayer)("discord management rpc handlers", (it) => {
    it.effect(
      "denies connect start on the free plan before the service is called",
      () =>
        Effect.gen(function* () {
          const calls: string[] = [];
          const handlers = yield* DiscordManagementRpcHandlersEffect.pipe(
            Effect.provideService(DiscordManagementService, makeService(calls))
          );
          const organizationId = yield* seedWorkspace();

          const error = yield* Effect.flip(
            handlers
              .DiscordConnectStart({ organizationId })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(organizationId)
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
          if (error._tag !== "PolicyDenied") {
            return yield* Effect.die("Expected PolicyDenied");
          }
          expect(error.reason).toContain("Starter plan");
          expect(calls).toEqual([]);
        })
    );

    it.effect(
      "starts the connect flow on a plan that includes integrations",
      () =>
        Effect.gen(function* () {
          const calls: string[] = [];
          const handlers = yield* DiscordManagementRpcHandlersEffect.pipe(
            Effect.provideService(DiscordManagementService, makeService(calls))
          );
          const organizationId = yield* seedWorkspace({ paid: true });

          const started = yield* handlers
            .DiscordConnectStart({ organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(organizationId))
            );

          expect(started.authorizeUrl.hostname).toBe("discord.com");
          expect(calls).toEqual([organizationId]);
        })
    );
  });
});
