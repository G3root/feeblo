import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { PostStatusId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CurrentSession, type Session } from "../session-middleware";
import { PostStatusRpcHandlersEffect } from "./handlers";
import { PostStatusRepository } from "./repository";

describe("PostStatusRpcHandlers", () => {
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
      ? [{
          membershipId: fixture.membershipId,
          organizationId: fixture.organizationId,
          role: "owner",
        }]
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

  const TestLayer = Layer.merge(
    PostStatusRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    Database.PgliteDatabaseLive,
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("lists statuses for organization members in display order", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const laterId = yield* PostStatusId.generate;
        const firstId = yield* PostStatusId.generate;

        yield* db.insert(schema.postStatusTable).values([
          { id: laterId, type: "COMPLETED", orderIndex: 1, organizationId: fixture.organizationId },
          { id: firstId, type: "PENDING", orderIndex: 0, organizationId: fixture.organizationId },
        ]);

        const statuses = yield* handlers.PostStatusList({ organizationId: fixture.organizationId }).pipe(
          Effect.provideService(CurrentSession, makeSession(fixture)),
        );

        expect(statuses.map((status) => status.id)).toEqual([firstId, laterId]);
      }),
    );

    it.effect("rejects non-members from listing statuses", () =>
      Effect.gen(function* () {
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers.PostStatusList({ organizationId: fixture.organizationId }).pipe(
            Effect.provideService(CurrentSession, makeSession(fixture, false)),
          ),
        );

        expect(error._tag).toBe("PolicyDenied");
      }),
    );

    it.effect("lists statuses publicly without a session", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const statusId = yield* PostStatusId.generate;

        yield* db.insert(schema.postStatusTable).values({
          id: statusId,
          type: "IN_PROGRESS",
          orderIndex: 0,
          organizationId: fixture.organizationId,
        });

        const statuses = yield* handlers.PostStatusListPublic({ organizationId: fixture.organizationId });
        expect(statuses).toHaveLength(1);
        expect(statuses[0]).toMatchObject({ id: statusId, type: "IN_PROGRESS" });
      }),
    );
  });
});
