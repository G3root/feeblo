import { DB } from "@feeblo/db";
import {
  member as memberTable,
  organization as organizationTable,
  product as productTable,
  subscription as subscriptionTable,
} from "@feeblo/db/schema/auth";
import {
  board as boardTable,
  DEFAULT_POST_STATUSES,
  postStatus as postStatusTable,
  site as siteTable,
} from "@feeblo/db/schema/feedback";
import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Array as EffectArray, Option } from "effect";
import { FailedToCreateWorkspaceError } from "./errors";

const makeWorkspaceRepository = Effect.gen(function* () {
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
          return yield* new FailedToCreateWorkspaceError({
            message: "Failed to create organization",
          });
        }
        const organizationId = organization.value.id;

        yield* db.insert(memberTable).values({
          id: generateId("member"),
          organizationId,
          role: "owner",
          createdAt: new Date(),
          userId,
        });

        for (const postStatus of DEFAULT_POST_STATUSES) {
          yield* db.insert(postStatusTable).values({
            id: generateId("postStatus"),
            organizationId,
            type: postStatus.type,
            orderIndex: postStatus.orderIndex,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

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

        yield* db.insert(siteTable).values({
          id: generateId("site"),
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
          name: workspaceName,
          subdomain: slug,
          hidePoweredBy: false,
        });

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
    findPlanByOrganizationId: ({
      organizationId,
    }: {
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const [subscription] = yield* db
          .select({
            organizationId: subscriptionTable.organizationId,
            plan: productTable.metadata,
          })
          .from(subscriptionTable)
          .innerJoin(
            productTable,
            eq(productTable.id, subscriptionTable.productId)
          )
          .where(
            and(
              eq(subscriptionTable.organizationId, organizationId),
              eq(subscriptionTable.status, "active")
            )
          )
          .orderBy(
            desc(subscriptionTable.currentPeriodEnd),
            desc(subscriptionTable.createdAt)
          )
          .limit(1);

        return {
          organizationId,
          plan: subscription?.plan?.plan ?? "free",
        } as const;
      }),
  };
});

export class WorkspaceRepository extends Effect.Service<WorkspaceRepository>()(
  "WorkspaceRepository",
  {
    effect: makeWorkspaceRepository,
  }
) {
  static readonly layer = this.Default;
}
