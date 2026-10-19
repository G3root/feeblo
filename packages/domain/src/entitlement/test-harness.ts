import { currentDb, schema } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

/**
 * Puts a workspace on the Starter plan.
 *
 * The plan is what the entitlement policies read, so a test that needs a paid
 * workspace — a private board, a board count the free plan allows, a public
 * API — needs one. A product row on its own is not a plan: the plan is read
 * through an *entitled* subscription, so the subscription row is the half that
 * decides.
 *
 * The period end is a month out, which is what `entitledSubscriptionCondition`
 * asks for. A test that wants the plan to lapse mid-test moves the row
 * instead of reaching for a second helper.
 */
export const grantStarterPlan = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;
    const productId = `product_starter_${organizationId}`;

    yield* db.insert(schema.productTable).values({
      id: productId,
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
      id: `subscription_starter_${organizationId}`,
      externalId: `external_starter_${organizationId}`,
      organizationId,
      amount: 2900,
      cancelAtPeriodEnd: false,
      currency: "usd",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: DateTime.toDateUtc(
        DateTime.addDuration(DateTime.fromDateUnsafe(now), Duration.days(30))
      ),
      customerId: `customer_starter_${organizationId}`,
      productId,
      createdAt: now,
      updatedAt: now,
    });
  });
