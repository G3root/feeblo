import { DB } from "@feeblo/db";
import {
  member as memberTable,
  organization as organizationTable,
  product as productTable,
  subscription as subscriptionTable,
} from "@feeblo/db/schema/auth";
import { board as boardTable } from "@feeblo/db/schema/feedback";
import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq } from "drizzle-orm";
import { Effect, Array as EffectArray, Option } from "effect";

export class WorkspaceRepository extends Effect.Service<WorkspaceRepository>()(
  "WorkspaceRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        isOrganizationSlugTaken: ({ slug }: { slug: string }) =>
          Effect.gen(function* () {
            const [row] = yield* db
              .select({ id: organizationTable.id })
              .from(organizationTable)
              .where(eq(organizationTable.slug, slug))
              .limit(1);

            return Boolean(row);
          }),
        createWorkspace: ({
          userId,
          workspaceName,
          slug,
        }: {
          userId: string;
          workspaceName: string;
          slug: string;
        }) =>
          Effect.gen(function* () {
            const organization = yield* db
              .insert(organizationTable)
              .values({
                id: generateId("organization"),
                name: workspaceName,
                slug,
                createdAt: new Date(),
              })
              .returning()
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isNone(organization)) {
              return yield* Effect.fail(
                new Error("Failed to create organization")
              );
            }
            const organizationId = organization.value.id;

            yield* db.insert(memberTable).values({
              id: generateId("member"),
              organizationId,
              role: "owner",
              createdAt: new Date(),
              userId,
            });

            const defaultBoards = ["Bugs 🐞", "Features 💡"] as const;

            for (const boardName of defaultBoards) {
              yield* db.insert(boardTable).values({
                id: generateId("board"),
                name: boardName,
                slug: slugify(boardName),
                visibility: "PUBLIC",
                organizationId,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }

            return organizationId;
          }),
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
