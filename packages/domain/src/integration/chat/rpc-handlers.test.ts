import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../../entitlement/policies";
import { CurrentSession, type Session } from "../../session-middleware";
import { WorkspaceRepository } from "../../workspace/repository";
import type {
  ChatManagementSchemas,
  ChatManagementServiceContract,
} from "./management-service";
import { makeChatManagementRpcHandlers } from "./rpc-handlers";

/** The smallest schema bundle the shared handler factory needs. */
interface TestChatSchemas extends ChatManagementSchemas {
  readonly Channel: { readonly id: string };
  readonly ChannelList: { readonly organizationId: string };
  readonly ChannelNotificationsUpdate: {
    readonly channelId: string;
    readonly organizationId: string;
  };
  readonly Connection: { readonly id: string };
  readonly ConnectionDisconnect: { readonly organizationId: string };
  readonly ConnectionList: { readonly organizationId: string };
  readonly ConnectStarted: { readonly authorizeUrl: URL };
  readonly ConnectStart: { readonly organizationId: string };
  readonly IntegrationStatus: { readonly configured: boolean };
}

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
  const now = yield* DateTime.nowAsDate;
  yield* db.insert(schema.organizationTable).values({
    id: organizationId,
    name: "Chat gate workspace",
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
      currentPeriodEnd: DateTime.toDateUtc(
        DateTime.addDuration(DateTime.fromDateUnsafe(now), Duration.days(1))
      ),
      customerId: `customer_${organizationId}`,
      productId: `product_${organizationId}`,
    });
  }
  return organizationId;
});

/** Management service stub that records every forwarded connect request. */
const makeService = (
  calls: string[]
): ChatManagementServiceContract<TestChatSchemas> => ({
  connectComplete: () => Effect.die("not used"),
  connectStart: ({ organizationId }) =>
    Effect.sync(() => calls.push(organizationId)).pipe(
      Effect.as({
        authorizeUrl: new URL("https://example.com/oauth/authorize"),
      })
    ),
  disconnect: () => Effect.die("not used"),
  listChannels: () => Effect.die("not used"),
  listConnections: () => Effect.die("not used"),
  setChannelNotifications: () => Effect.die("not used"),
  status: Effect.succeed({ configured: true }),
});

describe("makeChatManagementRpcHandlers", () => {
  layer(TestLayer)("chat management rpc handlers", (it) => {
    it.effect(
      "denies connect start on the free plan before the service is called",
      () =>
        Effect.gen(function* () {
          const calls: string[] = [];
          const handlers = yield* makeChatManagementRpcHandlers(
            makeService(calls)
          );
          const organizationId = yield* seedWorkspace();

          const error = yield* Effect.flip(
            handlers
              .connectStart({ organizationId })
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
          const handlers = yield* makeChatManagementRpcHandlers(
            makeService(calls)
          );
          const organizationId = yield* seedWorkspace({ paid: true });

          const started = yield* handlers
            .connectStart({ organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(organizationId))
            );

          expect(started.authorizeUrl.hostname).toBe("example.com");
          expect(calls).toEqual([organizationId]);
        })
    );
  });
});
