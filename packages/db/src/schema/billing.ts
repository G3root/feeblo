import {
  and,
  eq,
  gt,
  inArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import { productTable, subscriptionTable } from "./auth";

/**
 * Product metadata plan keys that grant paid entitlements. Keep in sync with
 * `PLAN_ENTITLEMENTS` in `@feeblo/domain/plan-entitlements`, which owns the
 * entitlement semantics for every plan key listed here.
 */
export const PAID_PRODUCT_PLAN_KEYS = ["starter", "professional"] as const;

/**
 * SQL condition matching a subscription that currently grants plan
 * entitlements: `active`/`trialing`, or `past_due` while its paid period has
 * not ended. This is the single persistence-level definition of "currently
 * entitled" shared by plan resolution and integration gating.
 */
export const entitledSubscriptionCondition = (now: Date) =>
  or(
    inArray(subscriptionTable.status, ["active", "trialing"]),
    and(
      eq(subscriptionTable.status, "past_due"),
      gt(subscriptionTable.currentPeriodEnd, now)
    )
  );

/**
 * SQL condition matching organizations that hold a currently entitled
 * subscription whose product carries a paid plan in its Polar metadata.
 * Correlate it against any organization-id column, such as
 * `organizationHasEntitledPaidSubscription(schema.integrationDeliveryTable.organizationId, now)`.
 */
export const organizationHasEntitledPaidSubscription = (
  organizationId: SQLWrapper,
  now: Date
): SQL<boolean> => {
  const queryBuilder = new QueryBuilder();
  return sql<boolean>`exists ${queryBuilder
    .select({ one: sql`1` })
    .from(subscriptionTable)
    .innerJoin(productTable, eq(productTable.id, subscriptionTable.productId))
    .where(
      and(
        eq(subscriptionTable.organizationId, organizationId),
        entitledSubscriptionCondition(now),
        inArray(sql`${productTable.metadata}->>'plan'`, [
          ...PAID_PRODUCT_PLAN_KEYS,
        ])
      )
    )}`;
};
