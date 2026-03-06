import { DB } from "@feeblo/db";
import {
  product as productTable,
  subscription as subscriptionTable,
} from "@feeblo/db/schema/auth";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

export class WorkspaceRepository extends Effect.Service<WorkspaceRepository>()(
  "WorkspaceRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findProducts: () =>
          db
            .select({
              id: productTable.id,
              name: productTable.name,
              description: productTable.description,
              trialInterval: productTable.trialInterval,
              trialIntervalCount: productTable.trialIntervalCount,
              recurringInterval: productTable.recurringInterval,
              recurringIntervalCount: productTable.recurringIntervalCount,
              isRecurring: productTable.isRecurring,
              isArchived: productTable.isArchived,
              externalOrganizationId: productTable.externalOrganizationId,
              visibility: productTable.visibility,
              prices: productTable.prices,
              metadata: productTable.metadata,
              createdAt: productTable.createdAt,
              updatedAt: productTable.updatedAt,
            })
            .from(productTable)
            .where(eq(productTable.isArchived, false)),
        findSubscriptionByOrganizationId: ({
          organizationId,
        }: {
          organizationId: string;
        }) =>
          db
            .select({
              id: subscriptionTable.id,
              externalId: subscriptionTable.externalId,
              organizationId: subscriptionTable.organizationId,
              amount: subscriptionTable.amount,
              cancelAtPeriodEnd: subscriptionTable.cancelAtPeriodEnd,
              currency: subscriptionTable.currency,
              recurringInterval: subscriptionTable.recurringInterval,
              recurringIntervalCount: subscriptionTable.recurringIntervalCount,
              status: subscriptionTable.status,
              currentPeriodStart: subscriptionTable.currentPeriodStart,
              currentPeriodEnd: subscriptionTable.currentPeriodEnd,
              trialStart: subscriptionTable.trialStart,
              trialEnd: subscriptionTable.trialEnd,
              canceledAt: subscriptionTable.canceledAt,
              startedAt: subscriptionTable.startedAt,
              endsAt: subscriptionTable.endsAt,
              endedAt: subscriptionTable.endedAt,
              customerId: subscriptionTable.customerId,
              productId: subscriptionTable.productId,
              discountId: subscriptionTable.discountId,
              checkoutId: subscriptionTable.checkoutId,
              seats: subscriptionTable.seats,
              createdAt: subscriptionTable.createdAt,
              updatedAt: subscriptionTable.updatedAt,
            })
            .from(subscriptionTable)
            .where(and(eq(subscriptionTable.organizationId, organizationId))),
      };
    }),
  }
) {}
