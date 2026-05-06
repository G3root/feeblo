import { Database, schema, type TxFn } from "@feeblo/db";
import { generateId, type UserId, type WorkspaceId } from "@feeblo/utils/id";
import { and, desc, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";
import { FailedToCreateWorkspaceError } from "./errors";

const makeWorkspaceRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    isOrganizationSlugTaken: (slug: string, tx?: TxFn) => {
      return db
        .makeQuery((execute, slug: string) =>
          execute((client) =>
            client
              .select()
              .from(schema.organizationTable)
              .where(eq(schema.organizationTable.slug, slug))
              .limit(1)
          )
        )(slug, tx)
        .pipe(Effect.map((results) => Option.fromNullishOr(results[0])));
    },

    createWorkspace: (
      args: {
        userId: UserId;
        workspaceName: string;
        slug: string;
      },
      tx?: TxFn
    ) => {
      const organization = db
        .makeQuery((execute) =>
          execute((client) =>
            client
              .insert(schema.organizationTable)
              .values({
                id: generateId("workspace"),
                name: args.workspaceName,
                slug: args.slug,
                createdAt: new Date(),
              })
              .returning()
          )
        )(tx)
        .pipe(Effect.map(EffectArray.get(0)));

      if (Option.isNone(organization)) {
        return (
          yield *
          new FailedToCreateWorkspaceError({
            message: "Failed to create organization",
          })
        );
      }

      const organizationId = organization.value.id;
    },

    // createWorkspace: (
    //   {
    //     userId,
    //     workspaceName,
    //     slug,
    //   }: {
    //     userId: UserId;
    //     workspaceName: string;
    //     slug: string;
    //   },
    //   tx?: TxFn
    // ) =>
    //   Effect.gen(function* () {
    //     const organization = yield* db
    //       .insert(organizationTable)
    //       .values({
    //         id: generateId("organization"),
    //         name: workspaceName,
    //         slug,
    //         createdAt: new Date(),
    //       })
    //       .returning()
    //       .pipe(Effect.map(EffectArray.get(0)));

    //     if (Option.isNone(organization)) {
    //       return yield* new FailedToCreateWorkspaceError({
    //         message: "Failed to create organization",
    //       });
    //     }
    //     const organizationId = organization.value.id;

    //     yield* db.insert(memberTable).values({
    //       id: generateId("member"),
    //       organizationId,
    //       role: "owner",
    //       createdAt: new Date(),
    //       userId,
    //     });

    //     for (const postStatus of DEFAULT_POST_STATUSES) {
    //       yield* db.insert(postStatusTable).values({
    //         id: generateId("postStatus"),
    //         organizationId,
    //         type: postStatus.type,
    //         orderIndex: postStatus.orderIndex,
    //         createdAt: new Date(),
    //         updatedAt: new Date(),
    //       });
    //     }

    //     const defaultBoards = ["Bugs 🐞", "Features 💡"] as const;

    //     for (const boardName of defaultBoards) {
    //       yield* db.insert(boardTable).values({
    //         id: generateId("board"),
    //         name: boardName,
    //         slug: slugify(boardName),
    //         visibility: "PUBLIC",
    //         organizationId,
    //         createdAt: new Date(),
    //         updatedAt: new Date(),
    //       });
    //     }

    //     yield* db.insert(siteTable).values({
    //       id: generateId("site"),
    //       organizationId,
    //       createdAt: new Date(),
    //       updatedAt: new Date(),
    //       name: workspaceName,
    //       subdomain: slug,
    //       hidePoweredBy: false,
    //     });

    //     return organizationId;
    //   }),

    findProducts: (tx?: TxFn) => {
      return db
        .makeQuery((execute) =>
          execute((client) =>
            client
              .select({
                id: schema.productTable.id,
                name: schema.productTable.name,
                description: schema.productTable.description,
                trialInterval: schema.productTable.trialInterval,
                trialIntervalCount: schema.productTable.trialIntervalCount,
                recurringInterval: schema.productTable.recurringInterval,
                recurringIntervalCount:
                  schema.productTable.recurringIntervalCount,
                isRecurring: schema.productTable.isRecurring,
                isArchived: schema.productTable.isArchived,
                externalOrganizationId:
                  schema.productTable.externalOrganizationId,
                visibility: schema.productTable.visibility,
                prices: schema.productTable.prices,
                metadata: schema.productTable.metadata,
                createdAt: schema.productTable.createdAt,
                updatedAt: schema.productTable.updatedAt,
              })
              .from(schema.productTable)
              .where(eq(schema.productTable.isArchived, false))
          )
        )(tx)
        .pipe(Effect.map((results) => results));
    },

    findPlanByOrganizationId: (workspaceId: WorkspaceId, tx?: TxFn) => {
      return db
        .makeQuery((execute, workspaceId: WorkspaceId) =>
          execute((client) =>
            client
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
                  eq(schema.subscriptionTable.organizationId, workspaceId),
                  eq(schema.subscriptionTable.status, "active")
                )
              )
              .orderBy(
                desc(schema.subscriptionTable.currentPeriodEnd),
                desc(schema.subscriptionTable.createdAt)
              )
              .limit(1)
          )
        )(workspaceId, tx)
        .pipe(
          Effect.map(EffectArray.get(0)),
          Effect.map(
            Option.map((subscription) => subscription.plan?.plan ?? "free")
          ),
          Effect.map((plan) => ({
            organizationId: workspaceId,
            plan,
          }))
        );
    },
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
