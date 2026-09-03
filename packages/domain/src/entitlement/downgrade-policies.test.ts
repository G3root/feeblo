import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import type { TIntegrationProviderKey } from "@feeblo/db/validation-schema/integration";
import { IntegrationProviderKey } from "@feeblo/domain-contracts/integration";
import { IntegrationConnectionId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkspaceRepository } from "../workspace/repository";
import { EntitlementPolicy } from "./policies";

const TestLayer = EntitlementPolicy.layer.pipe(
  Layer.provide(WorkspaceRepository.layer),
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

const seedOrganization = Effect.fn("test.seedOrganization")(function* (
  name: string
) {
  const db = yield* currentDb;
  const organizationId = yield* WorkspaceId.generate;
  yield* db.insert(schema.organizationTable).values({
    id: organizationId,
    name,
    slug: organizationId,
    createdAt: new Date(),
  });
  return organizationId;
});

/** Seeds an entitled `starter` subscription whose period ends in the future. */
const seedStarterPlan = Effect.fn("test.seedStarterPlan")(function* (
  organizationId: string,
  options: { readonly cancelAtPeriodEnd?: boolean } = {}
) {
  const db = yield* currentDb;
  const now = new Date();
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
    cancelAtPeriodEnd: options.cancelAtPeriodEnd ?? false,
    currency: "usd",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 14 * 86_400_000),
    customerId: `customer_${organizationId}`,
    productId: `product_${organizationId}`,
    createdAt: now,
    updatedAt: now,
  });
});

const seedConnection = Effect.fn("test.seedConnection")(function* (input: {
  readonly organizationId: string;
  readonly provider: string;
  readonly lifecycle:
    | "connecting"
    | "active"
    | "paused"
    | "reauth_required"
    | "revocation_unconfirmed"
    | "disconnecting"
    | "archived";
}) {
  const db = yield* currentDb;
  const id = yield* IntegrationConnectionId.generate;
  // SAFETY: the provider column stores the canonical provider vocabulary; the test providers ("slack", "discord", "github", "webhook") are members of it.
  const provider = IntegrationProviderKey.make(
    input.provider
  ) as TIntegrationProviderKey;
  yield* db.insert(schema.integrationConnectionTable).values({
    id,
    organizationId: input.organizationId,
    provider,
    name: `Test ${input.provider} connection`,
    lifecycle: input.lifecycle,
  });
  return id;
});

describe("downgrade entitlement policy", () => {
  layer(TestLayer)("derived downgrade state", (it) => {
    it.effect(
      "reports a free workspace without integration connections as not downgraded",
      () =>
        Effect.gen(function* () {
          const policy = yield* EntitlementPolicy;
          const organizationId = yield* seedOrganization("No connections");

          const state = yield* policy.getDowngradeState(organizationId);
          const mayUse = yield* policy.mayUseIntegrations(organizationId);

          expect(state).toEqual({
            integrationCount: 0,
            integrationLimit: 0,
            isDowngraded: false,
            plan: "free",
            scheduledDowngrade: null,
          });
          expect(mayUse).toBe(false);
        })
    );

    it.effect("denies a new connection on the free plan", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const organizationId = yield* seedOrganization("Free connect gate");

        const error = yield* Effect.flip(
          policy.canUseIntegrations(organizationId)
        );

        expect(error._tag).toBe("PolicyDenied");
        if (error._tag !== "PolicyDenied") {
          return yield* Effect.die("Expected PolicyDenied");
        }
        expect(error.reason).toContain("Starter plan");
      })
    );

    it.effect(
      "marks a free workspace as downgraded while it holds non-webhook connections",
      () =>
        Effect.gen(function* () {
          const policy = yield* EntitlementPolicy;
          const organizationId = yield* seedOrganization("Holding connections");

          yield* seedConnection({
            organizationId,
            provider: "slack",
            lifecycle: "active",
          });
          yield* seedConnection({
            organizationId,
            provider: "discord",
            lifecycle: "paused",
          });
          yield* seedConnection({
            organizationId,
            provider: "github",
            lifecycle: "reauth_required",
          });
          // Webhook endpoints stay available on every plan and never count.
          yield* seedConnection({
            organizationId,
            provider: "webhook",
            lifecycle: "active",
          });
          // Removed connections no longer hold the entitlement.
          yield* seedConnection({
            organizationId,
            provider: "slack",
            lifecycle: "archived",
          });

          const state = yield* policy.getDowngradeState(organizationId);

          expect(state.isDowngraded).toBe(true);
          expect(state.integrationCount).toBe(3);
          expect(state.integrationLimit).toBe(0);
          expect(state.plan).toBe("free");
        })
    );

    it.effect(
      "never marks an entitled workspace as downgraded while it holds connections",
      () =>
        Effect.gen(function* () {
          const policy = yield* EntitlementPolicy;
          const organizationId = yield* seedOrganization("Paid connections");
          yield* seedStarterPlan(organizationId);
          yield* seedConnection({
            organizationId,
            provider: "slack",
            lifecycle: "active",
          });
          yield* seedConnection({
            organizationId,
            provider: "github",
            lifecycle: "connecting",
          });

          const state = yield* policy.getDowngradeState(organizationId);
          const mayUse = yield* policy.mayUseIntegrations(organizationId);

          expect(state.isDowngraded).toBe(false);
          expect(state.integrationCount).toBe(2);
          expect(state.integrationLimit).toBeNull();
          expect(state.plan).toBe("starter");
          expect(state.scheduledDowngrade).toBeNull();
          expect(mayUse).toBe(true);
        })
    );

    it.effect(
      "reports a scheduled downgrade while an active subscription is canceled at period end",
      () =>
        Effect.gen(function* () {
          const policy = yield* EntitlementPolicy;
          const organizationId = yield* seedOrganization("Canceling soon");
          yield* seedStarterPlan(organizationId, {
            cancelAtPeriodEnd: true,
          });

          const state = yield* policy.getDowngradeState(organizationId);

          expect(state.plan).toBe("starter");
          expect(state.isDowngraded).toBe(false);
          expect(state.scheduledDowngrade).not.toBeNull();
          expect(state.scheduledDowngrade?.cancelAtPeriodEnd).toBe(true);
          expect(
            state.scheduledDowngrade?.currentPeriodEnd.getTime()
          ).toBeGreaterThan(Date.now());
        })
    );

    it.effect("permits a new connection on an entitled plan", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const organizationId = yield* seedOrganization("Paid connect gate");
        yield* seedStarterPlan(organizationId);

        yield* policy.canUseIntegrations(organizationId);
      })
    );
  });
});
