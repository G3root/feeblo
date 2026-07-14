import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CurrentSession,
  type Session,
} from "../session-middleware";
import { WorkspaceRpcHandlersEffect } from "./handlers";
import { WorkspaceRepository } from "./repository";

describe("WorkspaceRpcHandlers", () => {
  type Fixture = {
    organizationId: string;
    membershipId: string;
    userId: string;
  };

  const makeSession = (
    fixture: Fixture,
    role: Session["memberships"][number]["role"] | null = "owner",
  ): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: role
      ? [
          {
            membershipId: fixture.membershipId,
            organizationId: fixture.organizationId,
            role,
          },
        ]
      : [],
  });

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
      const now = new Date();

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test Organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "Test User",
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });

      return {
        organizationId,
        membershipId,
        userId,
      } satisfies Fixture;
    });

  const createSiteForSubdomain = (subdomain: string, orgId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const siteId = `site_${subdomain}`;
      yield* db.insert(schema.siteTable).values({
        id: siteId,
        name: "Existing Site",
        subdomain,
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

  const RepositoryTest = WorkspaceRepository.layer.pipe(
    Layer.provide(Database.PgliteDatabaseLive),
  );

  const TestLayer = Layer.merge(RepositoryTest, Database.PgliteDatabaseLive);

  layer(TestLayer)("handlers", (it) => {
    describe("WorkspaceCreate", () => {
      it.effect("creates a workspace with default boards and statuses", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const db = yield* currentDb;
          const userId = "user_new_workspace";

          yield* db.insert(schema.userTable).values({
            id: userId,
            email: "newuser@example.com",
            name: "New User",
          });

          const session: Session = {
            user: {
              id: userId,
              email: "newuser@example.com",
              name: "New User",
              restrictedToOrganizationId: null,
            },
            session: { userId, token: "test-token" },
            organizations: [],
            memberships: [],
          };

          const result = yield* handlers
            .WorkspaceCreate({ workspaceName: "My Awesome Workspace" })
            .pipe(Effect.provideService(CurrentSession, session));

          expect(result.organizationId).toBeDefined();

          // Verify the organization was created
          const orgs = yield* db
            .select()
            .from(schema.organizationTable)
            .where(eq(schema.organizationTable.id, result.organizationId));
          expect(orgs).toHaveLength(1);
          expect(orgs[0]?.name).toBe("My Awesome Workspace");
          expect(orgs[0]?.slug).toBe("my-awesome-workspace");

          // Verify a member was created with owner role
          const members = yield* db
            .select()
            .from(schema.memberTable)
            .where(eq(schema.memberTable.organizationId, result.organizationId));
          expect(members).toHaveLength(1);
          expect(members[0]?.userId).toBe(userId);
          expect(members[0]?.role).toBe("owner");

          // Verify default boards were created
          const boards = yield* db
            .select()
            .from(schema.boardTable)
            .where(eq(schema.boardTable.organizationId, result.organizationId));
          expect(boards).toHaveLength(2);
          const boardNames = boards.map((b) => b.name);
          expect(boardNames).toContain("Bugs 🐞");
          expect(boardNames).toContain("Features 💡");

          // Verify default post statuses were created
          const statuses = yield* db
            .select()
            .from(schema.postStatusTable)
            .where(eq(schema.postStatusTable.organizationId, result.organizationId));
          expect(statuses).toHaveLength(6);

          // Verify a site was created
          const sites = yield* db
            .select()
            .from(schema.siteTable)
            .where(eq(schema.siteTable.organizationId, result.organizationId));
          expect(sites).toHaveLength(1);
          expect(sites[0]?.subdomain).toBe("my-awesome-workspace");
          expect(sites[0]?.name).toBe("My Awesome Workspace");
        }),
      );

      it.effect(
        "rejects workspace names that produce subdomain shorter than 4 characters",
        () =>
          Effect.gen(function* () {
            const handlers = yield* WorkspaceRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const error = yield* Effect.flip(
              handlers
                .WorkspaceCreate({ workspaceName: "a" })
                .pipe(
                  Effect.provideService(
                    CurrentSession,
                    makeSession(fixture),
                  ),
                ),
            );

            expect(error._tag).toBe("BadRequestError");
            expect(error.message).toContain("at least 4 characters");
          }),
      );

      it.effect("rejects reserved subdomains", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();

          // "feeblo" is a reserved subdomain and is at least 4 characters
          const error = yield* Effect.flip(
            handlers
              .WorkspaceCreate({ workspaceName: "feeblo" })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture)),
              ),
          );

          expect(error._tag).toBe("BadRequestError");
          expect(error.message).toContain("reserved");
        }),
      );

      it.effect("rejects when the subdomain is already taken", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();

          // Create a site that claims the subdomain first
          yield* createSiteForSubdomain(
            "existing-workspace",
            fixture.organizationId,
          );

          const error = yield* Effect.flip(
            handlers
              .WorkspaceCreate({ workspaceName: "Existing Workspace" })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture)),
              ),
          );

          expect(error._tag).toBe("BadRequestError");
          expect(error.message).toBe("This workspace name is already taken");
        }),
      );
    });

    describe("WorkspaceProductList", () => {
      it.effect("returns an empty list when there are no products", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const products = yield* handlers
            .WorkspaceProductList()
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          expect(products).toEqual([]);
        }),
      );

      it.effect("lists non-archived products", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;

          yield* db.insert(schema.productTable).values({
            id: "prod_active",
            name: "Starter Plan",
            description: "The starter plan",
            isRecurring: true,
            isArchived: false,
            externalOrganizationId: "ext_1",
            visibility: "PUBLIC",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          yield* db.insert(schema.productTable).values({
            id: "prod_archived",
            name: "Old Plan",
            description: "An old plan",
            isRecurring: true,
            isArchived: true,
            externalOrganizationId: "ext_2",
            visibility: "PUBLIC",
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const products = yield* handlers
            .WorkspaceProductList()
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          expect(products).toHaveLength(1);
          expect(products[0]?.name).toBe("Starter Plan");
        }),
      );
    });

    describe("WorkspacePlanGet", () => {
      it.effect('returns "free" when no active subscription exists', () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const plan = yield* handlers
            .WorkspacePlanGet({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          expect(plan).toEqual({
            organizationId: fixture.organizationId,
            plan: "free",
          });
        }),
      );

      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .WorkspacePlanGet({ organizationId: fixture.organizationId })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null),
                ),
              ),
          );

          expect(error._tag).toBe("PolicyDenied");
        }),
      );

      it.effect("returns the plan from an active subscription", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;

          yield* db.insert(schema.productTable).values({
            id: "prod_starter",
            name: "Starter Plan",
            description: "The starter plan",
            isRecurring: true,
            isArchived: false,
            externalOrganizationId: "ext_1",
            visibility: "PUBLIC",
            metadata: { plan: "starter", variant: "monthly" },
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          yield* db.insert(schema.subscriptionTable).values({
            id: "sub_active",
            externalId: "sub_ext_1",
            organizationId: fixture.organizationId,
            amount: 29,
            cancelAtPeriodEnd: false,
            currency: "usd",
            recurringInterval: "month",
            recurringIntervalCount: 1,
            status: "active",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000,
            ),
            customerId: "cus_1",
            productId: "prod_starter",
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const plan = yield* handlers
            .WorkspacePlanGet({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          expect(plan).toEqual({
            organizationId: fixture.organizationId,
            plan: "starter",
          });
        }),
      );
    });

    describe("WorkspaceSlugCheck", () => {
      it.effect("returns available: true for an unused slug", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const result = yield* handlers
            .WorkspaceSlugCheck({ slug: "my-unique-slug" })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          expect(result).toEqual({ available: true, suggestion: null });
        }),
      );

      it.effect("returns available: false for reserved subdomains", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const result = yield* handlers
            .WorkspaceSlugCheck({ slug: "app" })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          expect(result).toEqual({ available: false, suggestion: null });
        }),
      );

      it.effect("returns available: false with suggestion for taken slugs", () =>
        Effect.gen(function* () {
          const handlers = yield* WorkspaceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          yield* createSiteForSubdomain("taken-slug", fixture.organizationId);

          const result = yield* handlers
            .WorkspaceSlugCheck({ slug: "taken-slug" })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          expect(result.available).toBe(false);
          expect(result.suggestion).toBe("taken-slug-2");
        }),
      );
    });
  });
});
