import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
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
  const makeSession = (fixture: Fixture, isMember = true): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: isMember
      ? [
          {
            membershipId: fixture.membershipId,
            organizationId: fixture.organizationId,
            role: "owner",
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
              Effect.provideService(CurrentSession, makeSession(fixture, false))
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
  });
});
