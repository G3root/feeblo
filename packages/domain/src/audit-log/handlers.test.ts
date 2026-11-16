import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { AuditLogId, type LegidOf, WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { AuditLogRpcHandlersEffect } from "./handlers";
import { AuditLogRepository, type TAuditLogInsert } from "./repository";

const T0 = new Date("2026-01-01T00:00:00.000Z");

const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe("AuditLogRpcHandlers", () => {
  type Fixture = {
    memberId: string;
    organizationId: LegidOf<"WorkspaceId">;
    role: "admin" | "manager";
    userId: string;
  };

  const makeFixture = (role: "admin" | "manager" = "admin") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = `user_${organizationId}`;
      const memberId = `member_${organizationId}`;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Audit workspace",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "Test user",
      });
      yield* db.insert(schema.memberTable).values({
        createdAt: now,
        id: memberId,
        organizationId,
        role,
        userId,
      });

      return { memberId, organizationId, role, userId } satisfies Fixture;
    });

  const session = (fixture: Fixture): Session => ({
    user: {
      email: "user@example.com",
      id: fixture.userId,
      name: "Test user",
      restrictedToOrganizationId: null,
    },
    session: { token: "test-token", userId: fixture.userId },
    organizations: [{ id: fixture.organizationId }],
    memberships: [
      {
        membershipId: fixture.memberId,
        organizationId: fixture.organizationId,
        role: fixture.role,
      },
    ],
  });

  const row = (
    organizationId: string,
    overrides: Partial<TAuditLogInsert> = {}
  ): Omit<TAuditLogInsert, "id"> => ({
    organizationId,
    occurredAt: T0,
    actorType: "user",
    actorUserId: "user_1",
    actorTokenId: null,
    actorLabel: null,
    actorRole: "admin",
    affectedUserId: null,
    source: "dashboard",
    action: "post.updated",
    outcome: "allowed",
    denialReason: null,
    resourceType: "post",
    resourceId: "post_1",
    changes: null,
    metadata: null,
    requestId: null,
    originIp: null,
    originCountry: null,
    userAgent: null,
    ...overrides,
  });

  const append = (
    organizationId: string,
    overrides: Partial<TAuditLogInsert> = {}
  ) =>
    Effect.gen(function* () {
      const repository = yield* AuditLogRepository;
      const id = yield* AuditLogId.generate;
      yield* repository.insert({ ...row(organizationId, overrides), id });

      return id;
    });

  const TestLayer = AuditLogRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect(
      "returns entries newest first, with the labels this build knows",
      () =>
        Effect.gen(function* () {
          const handlers = yield* AuditLogRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const older = yield* append(fixture.organizationId, {
            occurredAt: at(0),
          });

          const newer = yield* append(fixture.organizationId, {
            action: "board.exported",
            occurredAt: at(1),
            resourceType: "board",
            resourceId: "board_1",
          });

          const page = yield* handlers
            .ListAuditLogEntries({
              limit: 20,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));

          expect(page.items.map((entry) => entry.id)).toEqual([newer, older]);
          expect(page.items[0]?.actionLabel).toBe("Exported board");
          expect(page.items[0]?.resourceLabel).toBe("Board");
          expect(page.items[1]?.actionLabel).toBe("Updated post");
          expect(page.next).toBeNull();
        })
    );

    it.effect("pages on the cursor it returns", () =>
      Effect.gen(function* () {
        const handlers = yield* AuditLogRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const ids = yield* Effect.forEach([0, 1, 2], (minute) =>
          append(fixture.organizationId, { occurredAt: at(minute) })
        );

        const first = yield* handlers
          .ListAuditLogEntries({
            limit: 2,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        expect(first.items).toHaveLength(2);
        expect(first.next).not.toBeNull();

        if (first.next === null) return;

        const second = yield* handlers
          .ListAuditLogEntries({
            after: first.next,
            limit: 2,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        expect(
          [...first.items, ...second.items].map((entry) => entry.id)
        ).toEqual([...ids].toReversed());
        expect(second.next).toBeNull();
      })
    );

    it.effect("refuses a member below admin", () =>
      Effect.gen(function* () {
        const handlers = yield* AuditLogRpcHandlersEffect;
        const fixture = yield* makeFixture("manager");

        const failure = yield* Effect.flip(
          handlers
            .ListAuditLogEntries({
              limit: 20,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)))
        );

        expect(failure._tag).toBe("PolicyDenied");
      })
    );
  });
});
