import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { MemberId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EntitlementPolicy } from "../entitlement/policies";
import { CurrentSession, type Session } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { MembershipRpcHandlersEffect } from "./handlers";
import { MembershipPolicy } from "./policies";
import { MembershipRepository } from "./repository";

describe("MembershipRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: string;
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
      const membershipId = yield* MemberId.generate;
      const now = new Date();
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
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
      return { membershipId, organizationId, userId } satisfies Fixture;
    });
  const addAdmin = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const userId = `admin_${organizationId}`;
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${userId}@example.com`,
        name: "Admin User",
      });
      yield* db.insert(schema.memberTable).values({
        id: `membership_${userId}`,
        organizationId,
        userId,
        role: "admin",
        createdAt: new Date(),
      });
    });
  const Repositories = Layer.mergeAll(
    MembershipRepository.layer,
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );
  const Policies = MembershipPolicy.layer.pipe(
    Layer.provide(Entitlements),
    Layer.provide(Repositories)
  );
  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("lists the current user's memberships", () =>
      Effect.gen(function* () {
        const handlers = yield* MembershipRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const memberships = yield* handlers
          .MembershipList()
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(memberships).toMatchObject([
          { id: fixture.membershipId, organizationId: fixture.organizationId },
        ]);
      })
    );
    it.effect("rejects non-members from listing organization members", () =>
      Effect.gen(function* () {
        const handlers = yield* MembershipRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers
            .OrganizationMembersList({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );
    it.effect("allows regular invitations at the privileged role limit", () =>
      Effect.gen(function* () {
        const policy = yield* MembershipPolicy;
        const fixture = yield* makeFixture();
        yield* addAdmin(fixture.organizationId);

        yield* policy.canInviteRoleWithinPlan({
          organizationId: fixture.organizationId,
          role: "member",
        });
      })
    );
    it.effect("rejects privileged invitations at the plan limit", () =>
      Effect.gen(function* () {
        const policy = yield* MembershipPolicy;
        const fixture = yield* makeFixture();
        yield* addAdmin(fixture.organizationId);

        const error = yield* Effect.flip(
          policy.canInviteRoleWithinPlan({
            organizationId: fixture.organizationId,
            role: "admin",
          })
        );

        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
    it.effect("prevents an admin from promoting themselves to owner", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* MembershipRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const otherOwnerMemberId = yield* MemberId.generate;
        yield* db.insert(schema.userTable).values({
          id: `owner_${fixture.organizationId}`,
          email: `owner_${fixture.organizationId}@example.com`,
          name: "Other Owner",
        });
        yield* db.insert(schema.memberTable).values({
          id: otherOwnerMemberId,
          organizationId: fixture.organizationId,
          userId: `owner_${fixture.organizationId}`,
          role: "owner",
          createdAt: new Date(),
        });
        yield* db
          .update(schema.memberTable)
          .set({ role: "admin" })
          .where(eq(schema.memberTable.id, fixture.membershipId));

        const error = yield* Effect.flip(
          handlers
            .OrganizationUpdateMemberRole({
              organizationId: fixture.organizationId,
              memberId: fixture.membershipId,
              role: "owner",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "admin")
              )
            )
        );

        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
    it.effect("prevents an admin from assigning the owner role", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* MembershipRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const targetMemberId = yield* MemberId.generate;
        const otherOwnerMemberId = yield* MemberId.generate;
        yield* db.insert(schema.userTable).values({
          id: `member_${fixture.organizationId}`,
          email: `member_${fixture.organizationId}@example.com`,
          name: "Regular Member",
        });
        yield* db.insert(schema.memberTable).values({
          id: targetMemberId,
          organizationId: fixture.organizationId,
          userId: `member_${fixture.organizationId}`,
          role: "member",
          createdAt: new Date(),
        });
        yield* db.insert(schema.userTable).values({
          id: `owner_${fixture.organizationId}`,
          email: `owner_${fixture.organizationId}@example.com`,
          name: "Other Owner",
        });
        yield* db.insert(schema.memberTable).values({
          id: otherOwnerMemberId,
          organizationId: fixture.organizationId,
          userId: `owner_${fixture.organizationId}`,
          role: "owner",
          createdAt: new Date(),
        });
        yield* db
          .update(schema.memberTable)
          .set({ role: "admin" })
          .where(eq(schema.memberTable.id, fixture.membershipId));

        const error = yield* Effect.flip(
          handlers
            .OrganizationUpdateMemberRole({
              organizationId: fixture.organizationId,
              memberId: targetMemberId,
              role: "owner",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "admin")
              )
            )
        );

        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
    it.effect("allows an owner to assign the owner role", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* MembershipRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const targetMemberId = yield* MemberId.generate;
        yield* db.insert(schema.userTable).values({
          id: `member_${fixture.organizationId}`,
          email: `member_${fixture.organizationId}@example.com`,
          name: "Regular Member",
        });
        yield* db.insert(schema.memberTable).values({
          id: targetMemberId,
          organizationId: fixture.organizationId,
          userId: `member_${fixture.organizationId}`,
          role: "member",
          createdAt: new Date(),
        });

        yield* handlers
          .OrganizationUpdateMemberRole({
            organizationId: fixture.organizationId,
            memberId: targetMemberId,
            role: "owner",
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
      })
    );
    it.effect("prevents an admin from removing an owner", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* MembershipRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* addAdmin(fixture.organizationId);
        const ownerMemberId = yield* MemberId.generate;
        yield* db.insert(schema.userTable).values({
          id: `owner_${fixture.organizationId}`,
          email: `owner_${fixture.organizationId}@example.com`,
          name: "Other Owner",
        });
        yield* db.insert(schema.memberTable).values({
          id: ownerMemberId,
          organizationId: fixture.organizationId,
          userId: `owner_${fixture.organizationId}`,
          role: "owner",
          createdAt: new Date(),
        });
        yield* db
          .update(schema.memberTable)
          .set({ role: "admin" })
          .where(eq(schema.memberTable.id, fixture.membershipId));

        const error = yield* Effect.flip(
          handlers
            .OrganizationRemoveMember({
              organizationId: fixture.organizationId,
              memberId: ownerMemberId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "admin")
              )
            )
        );

        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
    it.effect("prevents an admin from removing another admin", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* MembershipRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* addAdmin(fixture.organizationId);
        const admin2MemberId = yield* MemberId.generate;
        yield* db.insert(schema.userTable).values({
          id: `admin2_${fixture.organizationId}`,
          email: `admin2_${fixture.organizationId}@example.com`,
          name: "Admin 2",
        });
        yield* db.insert(schema.memberTable).values({
          id: admin2MemberId,
          organizationId: fixture.organizationId,
          userId: `admin2_${fixture.organizationId}`,
          role: "admin",
          createdAt: new Date(),
        });
        yield* db
          .update(schema.memberTable)
          .set({ role: "admin" })
          .where(eq(schema.memberTable.id, fixture.membershipId));

        const error = yield* Effect.flip(
          handlers
            .OrganizationRemoveMember({
              organizationId: fixture.organizationId,
              memberId: admin2MemberId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "admin")
              )
            )
        );

        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
    it.effect("allows an admin to remove a regular member", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* MembershipRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* addAdmin(fixture.organizationId);
        const memberId = yield* MemberId.generate;
        yield* db.insert(schema.userTable).values({
          id: `member_${fixture.organizationId}`,
          email: `member_${fixture.organizationId}@example.com`,
          name: "Regular Member",
        });
        yield* db.insert(schema.memberTable).values({
          id: memberId,
          organizationId: fixture.organizationId,
          userId: `member_${fixture.organizationId}`,
          role: "member",
          createdAt: new Date(),
        });
        yield* db
          .update(schema.memberTable)
          .set({ role: "admin" })
          .where(eq(schema.memberTable.id, fixture.membershipId));

        yield* handlers
          .OrganizationRemoveMember({
            organizationId: fixture.organizationId,
            memberId,
          })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(fixture, "admin"))
          );
      })
    );
  });
});
