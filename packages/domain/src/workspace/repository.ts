import { Database, schema, type TxFn } from "@feeblo/db";
import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, desc, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";
import { FailedToCreateWorkspaceError } from "./errors";

interface CreateWorkspaceArgs {
  slug: string;
  userId: string;
  workspaceName: string;
}

interface CreatePostStatusArgs {
  organizationId: string;
  postStatus: (typeof schema.DEFAULT_POST_STATUSES)[number];
}

interface CreateBoardArgs {
  boardName: string;
  organizationId: string;
}

interface FindPlanByOrganizationIdArgs {
  organizationId: string;
}

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
        .pipe(Effect.map((results) => results.length > 0));
    },

    createWorkspace: (args: CreateWorkspaceArgs, tx?: TxFn) =>
      Effect.gen(function* () {
        const organization = yield* db
          .makeQuery((execute, input: CreateWorkspaceArgs) =>
            execute((client) =>
              client
                .insert(schema.organizationTable)
                .values({
                  id: generateId("workspace"),
                  name: input.workspaceName,
                  slug: input.slug,
                  createdAt: new Date(),
                })
                .returning()
            )
          )(args, tx)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(organization)) {
          return yield* new FailedToCreateWorkspaceError({
            message: "Failed to create organization",
          });
        }

        const organizationId = organization.value.id;

        yield* db.makeQuery((execute, input: CreateWorkspaceArgs) =>
          execute((client) =>
            client.insert(schema.memberTable).values({
              id: generateId("member"),
              organizationId,
              role: "owner",
              createdAt: new Date(),
              userId: input.userId,
            })
          )
        )(args, tx);

        for (const postStatus of schema.DEFAULT_POST_STATUSES) {
          yield* db.makeQuery((execute, input: CreatePostStatusArgs) =>
            execute((client) =>
              client.insert(schema.postStatusTable).values({
                id: generateId("postStatus"),
                organizationId: input.organizationId,
                type: input.postStatus.type,
                orderIndex: input.postStatus.orderIndex,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
            )
          )(
            {
              organizationId,
              postStatus,
            },
            tx
          );
        }

        const defaultBoards = ["Bugs 🐞", "Features 💡"] as const;

        for (const boardName of defaultBoards) {
          yield* db.makeQuery((execute, input: CreateBoardArgs) =>
            execute((client) =>
              client.insert(schema.boardTable).values({
                id: generateId("board"),
                name: input.boardName,
                slug: slugify(input.boardName),
                visibility: "PUBLIC",
                organizationId: input.organizationId,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
            )
          )(
            {
              boardName,
              organizationId,
            },
            tx
          );
        }

        yield* db.makeQuery((execute, input: CreateWorkspaceArgs) =>
          execute((client) =>
            client.insert(schema.siteTable).values({
              id: generateId("site"),
              organizationId,
              createdAt: new Date(),
              updatedAt: new Date(),
              name: input.workspaceName,
              subdomain: input.slug,
              hidePoweredBy: false,
            })
          )
        )(args, tx);

        return organizationId;
      }),

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
        )(undefined, tx)
        .pipe(Effect.map((results) => results));
    },

    findPlanByOrganizationId: (
      args: FindPlanByOrganizationIdArgs,
      tx?: TxFn
    ) => {
      return db
        .makeQuery((execute, input: FindPlanByOrganizationIdArgs) =>
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
                  eq(
                    schema.subscriptionTable.organizationId,
                    input.organizationId
                  ),
                  eq(schema.subscriptionTable.status, "active")
                )
              )
              .orderBy(
                desc(schema.subscriptionTable.currentPeriodEnd),
                desc(schema.subscriptionTable.createdAt)
              )
              .limit(1)
          )
        )(args, tx)
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
