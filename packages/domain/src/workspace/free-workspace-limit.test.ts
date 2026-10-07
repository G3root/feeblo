import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { ReservedSubdomainError } from "../site/subdomain/errors";
import { SubdomainValidationService } from "../site/subdomain/service";
import { WorkspaceRpcHandlersEffect } from "./handlers";
import { WorkspacePolicy } from "./policies";
import { WorkspaceRepository } from "./repository";

/**
 * The free workspace cap is per user, so these cases seed workspaces owned by
 * one user and create from that user's session. They live in their own file
 * because the paid fixtures insert `product` rows, and this file's PGlite
 * instance is separate from `handlers.test.ts`'s product-list assertions.
 */

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: string | number | Date): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

describe("free workspace limit", () => {
  /** A user row for the given id, with no memberships. */
  const seedUser = (userId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${userId}@example.com`,
        name: "Test User",
      });
    });

  const makeBareSession = (userId: string): Session => ({
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId, token: "test-token" },
    organizations: [],
    memberships: [],
  });

  /** A workspace owned by `userId`, optionally on an active paid plan. */
  const createOwnedWorkspace = (
    userId: string,
    options: { paid?: boolean } = {}
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Owned Workspace",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.memberTable).values({
        id: `membership_${organizationId}`,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });

      if (options.paid) {
        const productId = `product_${organizationId}`;
        yield* db.insert(schema.productTable).values({
          id: productId,
          name: "Starter",
          isArchived: false,
          isRecurring: true,
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
          currentPeriodEnd: dateAt(now.getTime() + 86_400_000),
          customerId: `customer_${organizationId}`,
          productId,
          createdAt: now,
          updatedAt: now,
        });
      }

      return organizationId;
    });

  const RepositoryTest = WorkspaceRepository.layer.pipe(
    Layer.provide(Database.PgliteDatabaseLive)
  );

  const WorkspacePolicyTest = WorkspacePolicy.layer.pipe(
    Layer.provide(RepositoryTest)
  );

  const MockSubdomainValidationLayer = Layer.effect(
    SubdomainValidationService,
    Effect.succeed({
      validate: (subdomain: string) => {
        if (subdomain === "feeblo" || subdomain === "app") {
          return Effect.fail(
            new ReservedSubdomainError({
              message: `"${subdomain}" is a reserved subdomain`,
            })
          );
        }
        return Effect.succeed({
          valid: true as const,
          message: "Subdomain is valid",
        });
      },
    })
  );

  const TestLayer = Layer.mergeAll(
    RepositoryTest,
    Database.PgliteDatabaseLive,
    MockSubdomainValidationLayer,
    WorkspacePolicyTest
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect(
      "allows an owner below the free workspace limit to create another",
      () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const userId = "user_below_workspace_limit";
          yield* seedUser(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId);

          const result = yield* handlers
            .WorkspaceCreate({ workspaceName: "Third Workspace" })
            .pipe(
              Effect.provideService(CurrentSession, makeBareSession(userId))
            );

          expect(result.organizationId).toBeDefined();
        })
    );

    it.effect(
      "rejects a fourth free workspace for an owner on the free plan",
      () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const userId = "user_at_workspace_limit";
          yield* seedUser(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId);

          const error = yield* Effect.flip(
            handlers
              .WorkspaceCreate({ workspaceName: "Fourth Workspace" })
              .pipe(
                Effect.provideService(CurrentSession, makeBareSession(userId))
              )
          );

          expect(error).toMatchObject({
            _tag: "PolicyDenied",
            reason: expect.stringContaining("3 workspaces"),
          });
        })
    );

    it.effect("does not count workspaces the user only belongs to", () =>
      Effect.gen(function* () {
        const handlers = yield* WorkspaceRpcHandlersEffect;
        const db = yield* currentDb;
        const ownerId = "user_membership_only_owner";
        const memberId = "user_membership_only_member";
        yield* seedUser(ownerId);
        yield* seedUser(memberId);

        const organizationIds = yield* Effect.forEach([0, 1, 2], () =>
          createOwnedWorkspace(ownerId)
        );
        yield* Effect.forEach(organizationIds, (organizationId) =>
          Effect.gen(function* () {
            yield* db.insert(schema.memberTable).values({
              id: `membership_managed_${organizationId}`,
              organizationId,
              userId: memberId,
              role: "manager",
              createdAt: yield* DateTime.nowAsDate,
            });
          })
        );

        const result = yield* handlers
          .WorkspaceCreate({ workspaceName: "Member Workspace" })
          .pipe(
            Effect.provideService(CurrentSession, makeBareSession(memberId))
          );

        expect(result.organizationId).toBeDefined();
      })
    );

    it.effect(
      "does not count paid workspaces toward the free workspace limit",
      () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const userId = "user_with_paid_workspace";
          yield* seedUser(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId, { paid: true });

          const result = yield* handlers
            .WorkspaceCreate({ workspaceName: "Third Free Workspace" })
            .pipe(
              Effect.provideService(CurrentSession, makeBareSession(userId))
            );

          expect(result.organizationId).toBeDefined();
        })
    );

    it.effect(
      "rejects another free workspace when the free cap is full even with a paid workspace",
      () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const userId = "user_with_full_free_cap";
          yield* seedUser(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId, { paid: true });

          const error = yield* Effect.flip(
            handlers
              .WorkspaceCreate({ workspaceName: "Fourth Free Workspace" })
              .pipe(
                Effect.provideService(CurrentSession, makeBareSession(userId))
              )
          );

          expect(error).toMatchObject({ _tag: "PolicyDenied" });
        })
    );

    it.effect(
      "reports that another workspace can be created below the cap",
      () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const userId = "user_creation_state_below_cap";
          yield* seedUser(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId);
          yield* createOwnedWorkspace(userId, { paid: true });

          const state = yield* handlers
            .WorkspaceCreationStateGet()
            .pipe(
              Effect.provideService(CurrentSession, makeBareSession(userId))
            );

          expect(state.canCreate).toBe(true);
          expect(state.reason).toBeNull();
          expect(state.freeWorkspaces).toHaveLength(2);
        })
    );

    it.effect("reports the cap and lists the counted free workspaces", () =>
      Effect.gen(function* () {
        const handlers = yield* WorkspaceRpcHandlersEffect;
        const userId = "user_creation_state_at_cap";
        yield* seedUser(userId);
        const organizationIds = yield* Effect.forEach([0, 1, 2], () =>
          createOwnedWorkspace(userId)
        );

        const state = yield* handlers
          .WorkspaceCreationStateGet()
          .pipe(Effect.provideService(CurrentSession, makeBareSession(userId)));

        expect(state.canCreate).toBe(false);
        expect(state.reason).toContain("3 workspaces");
        expect(state.freeWorkspaces.map(({ id }) => id).sort()).toEqual(
          [...organizationIds].sort()
        );
      })
    );

    it.effect("excludes paid workspaces from the free workspace list", () =>
      Effect.gen(function* () {
        const handlers = yield* WorkspaceRpcHandlersEffect;
        const userId = "user_creation_state_paid_excluded";
        yield* seedUser(userId);
        yield* createOwnedWorkspace(userId);
        yield* createOwnedWorkspace(userId, { paid: true });

        const state = yield* handlers
          .WorkspaceCreationStateGet()
          .pipe(Effect.provideService(CurrentSession, makeBareSession(userId)));

        expect(state.canCreate).toBe(true);
        expect(state.freeWorkspaces).toHaveLength(1);
      })
    );
  });
});
