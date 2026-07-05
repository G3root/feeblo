import { schema, currentDb } from "@feeblo/db";
import {
  BoardId,
  MemberId,
  PostStatusId,
  SiteId,
  WorkspaceId,
} from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, desc, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";
import { FailedToCreateWorkspaceError } from "./errors";

interface CreateWorkspaceArgs {
  subdomain: string;
  userId: string;
  workspaceName: string;
}

interface FindPlanByOrganizationIdArgs {
  organizationId: string;
}

const makeWorkspaceRepository = Effect.gen(function* () {
  return {
    isSubdomainTaken: (subdomain: string) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const results = yield* db
          .select({ id: schema.siteTable.id })
          .from(schema.siteTable)
          .where(eq(schema.siteTable.subdomain, subdomain))
          .limit(1);
        return results.length > 0;
      }),

    getSubdomainSuggestion: (subdomain: string) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        for (let i = 2; i <= 12; i++) {
          const candidate = `${subdomain}-${i}`;
          const results = yield* db
            .select({ id: schema.siteTable.id })
            .from(schema.siteTable)
            .where(eq(schema.siteTable.subdomain, candidate))
            .limit(1);
          if (results.length === 0) {
            return Option.some(candidate);
          }
        }
        return Option.none();
      }),

    createWorkspace: (args: CreateWorkspaceArgs) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const workspaceId = yield* WorkspaceId.generate;
        const organization = yield* db
          .insert(schema.organizationTable)
          .values({
            id: workspaceId,
            name: args.workspaceName,
            slug: args.subdomain,
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
        const memberId = yield* MemberId.generate;

        yield* db.insert(schema.memberTable).values({
          id: memberId,
          organizationId,
          role: "owner",
          createdAt: new Date(),
          userId: args.userId,
        });

        for (const postStatus of schema.DEFAULT_POST_STATUSES) {
          const postStatusId = yield* PostStatusId.generate;
          yield* db.insert(schema.postStatusTable).values({
            id: postStatusId,
            organizationId,
            type: postStatus.type,
            orderIndex: postStatus.orderIndex,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        const defaultBoards = ["Bugs 🐞", "Features 💡"] as const;

        for (const boardName of defaultBoards) {
          const boardId = yield* BoardId.generate;
          yield* db.insert(schema.boardTable).values({
            id: boardId,
            name: boardName,
            slug: slugify(boardName),
            visibility: "PUBLIC",
            organizationId,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        const siteId = yield* SiteId.generate;
        yield* db.insert(schema.siteTable).values({
          id: siteId,
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
          name: args.workspaceName,
          subdomain: args.subdomain,
          hidePoweredBy: false,
        });

        return organizationId;
      }),

    findProducts: () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.productTable.id,
            name: schema.productTable.name,
            description: schema.productTable.description,
            trialInterval: schema.productTable.trialInterval,
            trialIntervalCount: schema.productTable.trialIntervalCount,
            recurringInterval: schema.productTable.recurringInterval,
            recurringIntervalCount: schema.productTable.recurringIntervalCount,
            isRecurring: schema.productTable.isRecurring,
            isArchived: schema.productTable.isArchived,
            externalOrganizationId: schema.productTable.externalOrganizationId,
            visibility: schema.productTable.visibility,
            prices: schema.productTable.prices,
            metadata: schema.productTable.metadata,
            createdAt: schema.productTable.createdAt,
            updatedAt: schema.productTable.updatedAt,
          })
          .from(schema.productTable)
          .where(eq(schema.productTable.isArchived, false));
      }),

    findPlanByOrganizationId: (args: FindPlanByOrganizationIdArgs) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            organizationId: schema.subscriptionTable.organizationId,
            plan: schema.productTable.metadata,
          })
          .from(schema.subscriptionTable)
          .innerJoin(
            schema.productTable,
            eq(schema.productTable.id, schema.subscriptionTable.productId)
          )
          .where(
            and(
              eq(schema.subscriptionTable.organizationId, args.organizationId),
              eq(schema.subscriptionTable.status, "active")
            )
          )
          .orderBy(
            desc(schema.subscriptionTable.currentPeriodEnd),
            desc(schema.subscriptionTable.createdAt)
          )
          .limit(1)
          .pipe(
            Effect.map(EffectArray.get(0)),
            Effect.map(
              Option.match({
                onNone: () => "free" as const,
                onSome: (subscription) => subscription.plan?.plan ?? "free",
              })
            ),
            Effect.map((plan) => ({
              organizationId: args.organizationId,
              plan,
            }))
          );
      }),
  };
});

export class WorkspaceRepository extends Context.Service<WorkspaceRepository>()(
  "WorkspaceRepository",
  {
    make: makeWorkspaceRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
