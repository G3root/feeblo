import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkspaceRepository } from "../workspace/repository";
import { EntitlementPolicy } from "./policies";

const TestLayer = EntitlementPolicy.layer.pipe(
  Layer.provide(WorkspaceRepository.layer),
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

describe("email entitlement policy", () => {
  layer(TestLayer)("plan-aware email decisions", (it) => {
    it.effect(
      "allows one free submission recipient but no subscriber email",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const policy = yield* EntitlementPolicy;
          const organizationId = yield* WorkspaceId.generate;

          yield* db.insert(schema.organizationTable).values({
            id: organizationId,
            name: "Free email policy workspace",
            slug: organizationId,
            createdAt: new Date(),
          });

          const recipientLimit =
            yield* policy.submissionNotificationRecipientLimit(organizationId);
          const maySubscribe =
            yield* policy.mayCreatePublicEmailSubscriptions(organizationId);
          const maySendSubmission = yield* policy.mayMaterializeEmailIntent({
            organizationId,
            kind: "submission.created",
          });
          const maySendStatus = yield* policy.mayMaterializeEmailIntent({
            organizationId,
            kind: "post.status_changed",
          });

          expect(recipientLimit).toBe(1);
          expect(maySubscribe).toBe(false);
          expect(maySendSubmission).toBe(true);
          expect(maySendStatus).toBe(false);
        })
    );

    it.effect(
      "allows paid subscriber email and unlimited submission recipients",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const policy = yield* EntitlementPolicy;
          const organizationId = yield* WorkspaceId.generate;
          const now = new Date();

          yield* db.insert(schema.organizationTable).values({
            id: organizationId,
            name: "Paid email policy workspace",
            slug: organizationId,
            createdAt: now,
          });
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
            amount: 1000,
            cancelAtPeriodEnd: false,
            currency: "usd",
            recurringInterval: "month",
            recurringIntervalCount: 1,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 86_400_000),
            customerId: `customer_${organizationId}`,
            productId: `product_${organizationId}`,
            createdAt: now,
            updatedAt: now,
          });

          const recipientLimit =
            yield* policy.submissionNotificationRecipientLimit(organizationId);
          const maySubscribe =
            yield* policy.mayCreatePublicEmailSubscriptions(organizationId);
          const mayPublishChangelog = yield* policy.mayMaterializeEmailIntent({
            organizationId,
            kind: "changelog.published",
          });

          expect(recipientLimit).toBeNull();
          expect(maySubscribe).toBe(true);
          expect(mayPublishChangelog).toBe(true);
        })
    );
  });
});
