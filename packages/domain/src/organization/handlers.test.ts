import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { type LegidOf, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CurrentSession, type Session } from "../session-middleware";
import { OrganizationRpcHandlersEffect } from "./handlers";
import { OrganizationRepository } from "./repository";

describe("OrganizationRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    userId: string;
  };

  const makeSession = (
    fixture: Fixture,
    role: Session["memberships"][number]["role"] | null = "owner"
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
        membershipId,
        organizationId,
        userId,
      } satisfies Fixture;
    });

  const RepositoryTest = OrganizationRepository.layer.pipe(
    Layer.provide(Database.PgliteDatabaseLive)
  );

  const TestLayer = Layer.merge(RepositoryTest, Database.PgliteDatabaseLive);

  layer(TestLayer)("handlers", (it) => {
    describe("OrganizationList", () => {
      it.effect("returns organizations the user belongs to", () =>
        Effect.gen(function* () {
          const handlers = yield* OrganizationRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const organizations = yield* handlers
            .OrganizationList()
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(organizations).toHaveLength(1);
          expect(organizations[0]).toMatchObject({
            id: fixture.organizationId,
            name: "Test Organization",
            slug: fixture.organizationId,
          });
        })
      );

      it.effect(
        "returns an empty array when the user has no memberships in the database",
        () =>
          Effect.gen(function* () {
            const handlers = yield* OrganizationRpcHandlersEffect;
            const db = yield* currentDb;
            // Create a second user with no memberships
            const otherUserId = "user_no_membership";
            yield* db.insert(schema.userTable).values({
              id: otherUserId,
              email: "nomember@example.com",
              name: "No Member",
            });

            const sessionWithoutMemberships: Session = {
              user: {
                id: otherUserId,
                email: "nomember@example.com",
                name: "No Member",
                restrictedToOrganizationId: null,
              },
              session: { userId: otherUserId, token: "test-token" },
              organizations: [],
              memberships: [],
            };

            const organizations = yield* handlers
              .OrganizationList()
              .pipe(
                Effect.provideService(CurrentSession, sessionWithoutMemberships)
              );

            expect(organizations).toEqual([]);
          })
      );

      it.effect(
        "returns multiple organizations when the user belongs to many",
        () =>
          Effect.gen(function* () {
            const handlers = yield* OrganizationRpcHandlersEffect;
            const db = yield* currentDb;
            const fixture = yield* makeFixture();
            const now = new Date();

            // Create a second organization and membership
            const secondOrgId = yield* WorkspaceId.generate;
            yield* db.insert(schema.organizationTable).values({
              id: secondOrgId,
              name: "Second Organization",
              slug: secondOrgId,
              createdAt: now,
            });
            yield* db.insert(schema.memberTable).values({
              id: `membership_${secondOrgId}`,
              organizationId: secondOrgId,
              userId: fixture.userId,
              role: "member",
              createdAt: now,
            });

            // Build a session with both memberships
            const sessionWithTwo: Session = {
              user: {
                id: fixture.userId,
                email: "user@example.com",
                name: "Test User",
                restrictedToOrganizationId: null,
              },
              session: { userId: fixture.userId, token: "test-token" },
              organizations: [
                { id: fixture.organizationId },
                { id: secondOrgId },
              ],
              memberships: [
                {
                  membershipId: fixture.membershipId,
                  organizationId: fixture.organizationId,
                  role: "owner",
                },
                {
                  membershipId: `membership_${secondOrgId}`,
                  organizationId: secondOrgId,
                  role: "member",
                },
              ],
            };

            const organizations = yield* handlers
              .OrganizationList()
              .pipe(Effect.provideService(CurrentSession, sessionWithTwo));

            expect(organizations).toHaveLength(2);
            const names = organizations.map((org) => org.name);
            expect(names).toContain("Test Organization");
            expect(names).toContain("Second Organization");
          })
      );
    });

    describe("OrganizationUpdate", () => {
      const updateInput = (
        fixture: Fixture,
        name: string,
        logo: string | null = null
      ) => ({
        organizationId: fixture.organizationId,
        name,
        logo,
      });

      it.effect("allows owner to update the organization name and logo", () =>
        Effect.gen(function* () {
          const handlers = yield* OrganizationRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();

          yield* handlers
            .OrganizationUpdate(
              updateInput(
                fixture,
                "Updated Name",
                "https://example.com/logo.png"
              )
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const [org] = yield* db
            .select()
            .from(schema.organizationTable)
            .where(eq(schema.organizationTable.id, fixture.organizationId));

          expect(org?.name).toBe("Updated Name");
          expect(org?.logo).toBe("https://example.com/logo.png");
        })
      );

      it.effect("allows admin to update the organization", () =>
        Effect.gen(function* () {
          const handlers = yield* OrganizationRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();

          yield* handlers
            .OrganizationUpdate(updateInput(fixture, "Admin Updated"))
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "admin")
              )
            );

          const [org] = yield* db
            .select()
            .from(schema.organizationTable)
            .where(eq(schema.organizationTable.id, fixture.organizationId));

          expect(org?.name).toBe("Admin Updated");
        })
      );

      it.effect("rejects member (non-admin) updates", () =>
        Effect.gen(function* () {
          const handlers = yield* OrganizationRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const error = yield* Effect.flip(
            handlers
              .OrganizationUpdate(updateInput(fixture, "Member Update"))
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "member")
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* OrganizationRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const error = yield* Effect.flip(
            handlers
              .OrganizationUpdate(updateInput(fixture, "Outsider Update"))
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect(
        "fails with NotFoundError for a non-existent organization",
        () =>
          Effect.gen(function* () {
            const handlers = yield* OrganizationRpcHandlersEffect;
            const nonExistentOrgId = yield* WorkspaceId.generate;
            const userId = `user_${nonExistentOrgId}`;
            const membershipId = `membership_${nonExistentOrgId}`;

            // Build a session that claims membership for a non-existent org
            const sessionForGhostOrg: Session = {
              user: {
                id: userId,
                email: "ghost@example.com",
                name: "Ghost User",
                restrictedToOrganizationId: null,
              },
              session: { userId, token: "test-token" },
              organizations: [{ id: nonExistentOrgId }],
              memberships: [
                {
                  membershipId,
                  organizationId: nonExistentOrgId,
                  role: "owner" as const,
                },
              ],
            };

            const error = yield* Effect.flip(
              handlers
                .OrganizationUpdate({
                  organizationId: nonExistentOrgId,
                  name: "Ghost Org",
                  logo: null,
                })
                .pipe(Effect.provideService(CurrentSession, sessionForGhostOrg))
            );

            expect(error._tag).toBe("NotFoundError");
            expect(error.message).toBe("Organization not found");
          })
      );

      it.effect("allows setting logo to null to remove it", () =>
        Effect.gen(function* () {
          const handlers = yield* OrganizationRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();

          // First set a logo
          yield* db
            .update(schema.organizationTable)
            .set({ logo: "https://example.com/logo.png" })
            .where(eq(schema.organizationTable.id, fixture.organizationId));

          // Now remove it
          yield* handlers
            .OrganizationUpdate(updateInput(fixture, "Test Organization", null))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const [org] = yield* db
            .select()
            .from(schema.organizationTable)
            .where(eq(schema.organizationTable.id, fixture.organizationId));

          expect(org?.logo).toBeNull();
        })
      );
    });
  });
});
