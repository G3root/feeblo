import { currentDb, schema } from "@feeblo/db";
import { entitledSubscriptionCondition } from "@feeblo/db/schema/billing";
import type { TIntegrationConnectionLifecycleStatus } from "@feeblo/db/validation-schema/integration";
import { IntegrationProviderKey } from "@feeblo/domain-contracts/integration";
import {
  BoardId,
  ChangelogCategoryId,
  MemberId,
  PostStatusId,
  RoadmapColumnId,
  RoadmapId,
  SiteId,
  TagId,
  WorkspaceId,
} from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, count, desc, eq, inArray, notInArray } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { INTEGRATION_CAPABILITY_PROVIDER_KEYS } from "../plan-entitlements";
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
  const db = yield* currentDb;

  return {
    isSubdomainTaken: (subdomain: string) =>
      Effect.gen(function* () {
        const results = yield* db
          .select({ id: schema.siteTable.id })
          .from(schema.siteTable)
          .where(eq(schema.siteTable.subdomain, subdomain))
          .limit(1);
        return results.length > 0;
      }),

    getSubdomainSuggestion: (subdomain: string) =>
      Effect.gen(function* () {
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
      db.transaction((tx) =>
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          const workspaceId = yield* WorkspaceId.generate;
          const organization = yield* tx
            .insert(schema.organizationTable)
            .values({
              id: workspaceId,
              name: args.workspaceName,
              slug: args.subdomain,
              createdAt: now,
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

          yield* tx.insert(schema.memberTable).values({
            id: memberId,
            organizationId,
            role: "owner",
            createdAt: now,
            userId: args.userId,
          });

          for (const name of ["High Priority", "Low Priority"]) {
            const tagId = yield* TagId.generate;
            yield* tx.insert(schema.tagTable).values({
              id: tagId,
              name,
              slug: slugify(name),
              organizationId,
              creatorId: args.userId,
              creatorMemberId: memberId,
              createdAt: now,
              updatedAt: now,
            });
          }

          const statusIdByType = new Map<
            (typeof schema.DEFAULT_POST_STATUSES)[number]["type"],
            string
          >();

          for (const postStatus of schema.DEFAULT_POST_STATUSES) {
            const postStatusId = yield* PostStatusId.generate;
            yield* tx.insert(schema.postStatusTable).values({
              id: postStatusId,
              organizationId,
              type: postStatus.type,
              label: postStatus.label,
              color: postStatus.color,
              orderIndex: postStatus.orderIndex,
              createdAt: now,
              updatedAt: now,
            });
            statusIdByType.set(postStatus.type, postStatusId);
          }

          for (const category of schema.DEFAULT_CHANGELOG_CATEGORIES) {
            const categoryId = yield* ChangelogCategoryId.generate;
            yield* tx.insert(schema.changelogCategoryTable).values({
              id: categoryId,
              organizationId,
              name: category.name,
              iconType: category.iconType,
              icon: category.icon,
              createdAt: now,
              updatedAt: now,
            });
          }

          const roadmapId = yield* RoadmapId.generate;
          yield* tx.insert(schema.roadmapTable).values({
            id: roadmapId,
            organizationId,
            name: "Roadmap",
            slug: "roadmap",
            description: null,
            isPrimary: true,
            mode: "status",
            visibility: "public",
            filter: { version: 1, operator: "and", conditions: [] },
            createdAt: now,
            updatedAt: now,
          });

          const defaultRoadmapStatuses = [
            "PLANNED",
            "IN_PROGRESS",
            "COMPLETED",
          ] as const;
          for (const [position, type] of defaultRoadmapStatuses.entries()) {
            const statusId = statusIdByType.get(type);
            if (!statusId) {
              continue;
            }

            const columnId = yield* RoadmapColumnId.generate;
            yield* tx.insert(schema.roadmapColumnTable).values({
              id: columnId,
              roadmapId,
              name:
                type === "IN_PROGRESS"
                  ? "In progress"
                  : type[0] + type.slice(1).toLowerCase(),
              position,
              config: { type: "status", statusId },
              createdAt: now,
              updatedAt: now,
            });
          }

          const defaultBoards = ["Bugs 🐞", "Features 💡"] as const;

          for (const boardName of defaultBoards) {
            const boardId = yield* BoardId.generate;
            yield* tx.insert(schema.boardTable).values({
              id: boardId,
              name: boardName,
              slug: slugify(boardName),
              visibility: "PUBLIC",
              organizationId,
              createdAt: now,
              updatedAt: now,
            });
          }
          const siteId = yield* SiteId.generate;
          yield* tx.insert(schema.siteTable).values({
            id: siteId,
            organizationId,
            createdAt: now,
            updatedAt: now,
            name: args.workspaceName,
            subdomain: args.subdomain,
            hidePoweredBy: false,
          });

          return organizationId;
        })
      ),

    findProducts: () =>
      db
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
        .where(eq(schema.productTable.isArchived, false)),

    findPlanByOrganizationId: (args: FindPlanByOrganizationIdArgs) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        return yield* db
          .select({
            organizationId: schema.subscriptionTable.organizationId,
            plan: schema.productTable.metadata,
            cancelAtPeriodEnd: schema.subscriptionTable.cancelAtPeriodEnd,
            currentPeriodEnd: schema.subscriptionTable.currentPeriodEnd,
            status: schema.subscriptionTable.status,
          })
          .from(schema.subscriptionTable)
          .innerJoin(
            schema.productTable,
            eq(schema.productTable.id, schema.subscriptionTable.productId)
          )
          .where(
            and(
              eq(schema.subscriptionTable.organizationId, args.organizationId),
              entitledSubscriptionCondition(now)
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
                onNone: () => null,
                onSome: (subscription) => ({
                  organizationId: args.organizationId,
                  plan: subscription.plan?.plan ?? ("free" as const),
                  subscription: {
                    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                    currentPeriodEnd: subscription.currentPeriodEnd,
                    status: subscription.status,
                  },
                }),
              })
            ),
            Effect.map(
              (state) =>
                state ?? {
                  organizationId: args.organizationId,
                  plan: "free" as const,
                  subscription: null,
                }
            )
          );
      }),

    /**
     * Counts integration connections of providers gated by the `integrations`
     * capability that the workspace still holds — every lifecycle except the
     * terminal `archived`. Webhook connections stay available on every plan
     * and are never counted.
     */
    countPlanGatedIntegrationConnections: (
      args: FindPlanByOrganizationIdArgs
    ) =>
      Effect.gen(function* () {
        const [result] = yield* db
          .select({ total: count() })
          .from(schema.integrationConnectionTable)
          .where(
            and(
              eq(
                schema.integrationConnectionTable.organizationId,
                args.organizationId
              ),
              inArray(
                schema.integrationConnectionTable.provider,
                INTEGRATION_CAPABILITY_PROVIDER_KEYS.map((key) =>
                  IntegrationProviderKey.make(key)
                )
              ),
              notInArray(schema.integrationConnectionTable.lifecycle, [
                "archived",
              ] satisfies readonly TIntegrationConnectionLifecycleStatus[])
            )
          );
        return result?.total ?? 0;
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
