import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId, type LegidOf } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { EmailSuppressionRpcHandlersEffect } from "./handlers";
import { EmailSuppressionRepository } from "./repository";

describe("EmailSuppressionRpcHandlers", () => {
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
        name: "Suppression workspace",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "Test user",
      });
      yield* db.insert(schema.memberTable).values({
        id: memberId,
        organizationId,
        userId,
        role,
        createdAt: now,
      });
      return { memberId, organizationId, role, userId } satisfies Fixture;
    });

  const session = (fixture: Fixture): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test user",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: [
      {
        membershipId: fixture.memberId,
        organizationId: fixture.organizationId,
        role: fixture.role,
      },
    ],
  });

  const TestLayer = EmailSuppressionRepository.layer.pipe(
    Layer.provide(Database.PgliteDatabaseLive)
  );

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))(
    "handlers",
    (it) => {
      it.effect("adds, lists and counts a manual block", () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSuppressionRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const added = yield* handlers
            .AddEmailSuppression({
              email: "Blocked@Example.com",
              note: "Abuse report",
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));

          expect(added).toMatchObject({
            email: "blocked@example.com",
            firstReason: "administrative_block",
            note: "Abuse report",
            reason: "administrative_block",
          });

          const listed = yield* handlers
            .ListEmailSuppressions({
              limit: 20,
              offset: 0,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(listed.total).toBe(1);
          expect(listed.items.map((item) => item.email)).toEqual([
            "blocked@example.com",
          ]);

          const stats = yield* handlers
            .GetEmailSuppressionStats({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(stats).toEqual({
            administrativeBlock: 1,
            complaint: 0,
            hardBounce: 0,
            total: 1,
          });
        })
      );

      it.effect("keeps a manual block idempotent", () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSuppressionRpcHandlersEffect;
          const fixture = yield* makeFixture();

          for (const note of ["First report", "Second report"]) {
            yield* handlers
              .AddEmailSuppression({
                email: "repeat@example.com",
                note,
                organizationId: fixture.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(fixture)));
          }

          const listed = yield* handlers
            .ListEmailSuppressions({
              limit: 20,
              offset: 0,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(listed.total).toBe(1);
          expect(listed.items[0]?.note).toBe("Second report");
        })
      );

      it.effect("denies a role without emailSuppressions.manage", () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSuppressionRpcHandlersEffect;
          const fixture = yield* makeFixture("manager");

          const error = yield* Effect.flip(
            handlers
              .ListEmailSuppressions({
                limit: 20,
                offset: 0,
                organizationId: fixture.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(fixture)))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("never lists another workspace's or a platform row", () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* EmailSuppressionRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const otherOrganizationId = yield* WorkspaceId.generate;
          const now = yield* DateTime.nowAsDate;

          yield* db.insert(schema.organizationTable).values({
            id: otherOrganizationId,
            name: "Other workspace",
            slug: otherOrganizationId,
            createdAt: now,
          });
          yield* db.insert(schema.emailSuppressionTable).values([
            {
              email: "other@example.com",
              firstReason: "complaint",
              organizationId: otherOrganizationId,
              reason: "complaint",
              updatedAt: now,
            },
            {
              email: "platform@example.com",
              firstReason: "hard_bounce",
              organizationId: null,
              reason: "hard_bounce",
              updatedAt: now,
            },
          ]);

          const listed = yield* handlers
            .ListEmailSuppressions({
              limit: 20,
              offset: 0,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(listed.items).toHaveLength(0);
        })
      );

      it.effect(
        "removing a foreign row is a not-found and leaves it in place",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const handlers = yield* EmailSuppressionRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const otherOrganizationId = yield* WorkspaceId.generate;
            const now = yield* DateTime.nowAsDate;

            yield* db.insert(schema.organizationTable).values({
              id: otherOrganizationId,
              name: "Other workspace",
              slug: otherOrganizationId,
              createdAt: now,
            });
            yield* db.insert(schema.emailSuppressionTable).values({
              email: "foreign@example.com",
              firstReason: "complaint",
              organizationId: otherOrganizationId,
              reason: "complaint",
              updatedAt: now,
            });

            const error = yield* Effect.flip(
              handlers
                .RemoveEmailSuppression({
                  email: "foreign@example.com",
                  organizationId: fixture.organizationId,
                })
                .pipe(Effect.provideService(CurrentSession, session(fixture)))
            );
            expect(error._tag).toBe("NotFoundError");

            const [remaining] = yield* db
              .select({ email: schema.emailSuppressionTable.email })
              .from(schema.emailSuppressionTable)
              .where(
                eq(schema.emailSuppressionTable.email, "foreign@example.com")
              );
            expect(remaining?.email).toBe("foreign@example.com");
          })
      );

      it.effect("removes the workspace's own row", () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSuppressionRpcHandlersEffect;
          const fixture = yield* makeFixture();

          yield* handlers
            .AddEmailSuppression({
              email: "owned@example.com",
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));

          yield* handlers
            .RemoveEmailSuppression({
              email: "owned@example.com",
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));

          const listed = yield* handlers
            .ListEmailSuppressions({
              limit: 20,
              offset: 0,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(listed.total).toBe(0);
        })
      );
    }
  );
});
