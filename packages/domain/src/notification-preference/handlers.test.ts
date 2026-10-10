import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  NotificationPreferenceId,
  type LegidOf,
  WorkspaceId,
} from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { NotificationPreferenceRpcHandlersEffect } from "./handlers";
import { NotificationPreferenceRepository } from "./repository";

describe("NotificationPreferenceRpcHandlers", () => {
  type Fixture = {
    memberId: string;
    organizationId: LegidOf<"WorkspaceId">;
    userId: string;
  };

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = `user_${organizationId}`;
      const memberId = `member_${organizationId}`;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
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
        role: "manager",
        createdAt: now,
      });
      return { memberId, organizationId, userId } satisfies Fixture;
    });

  const session = (fixture: Fixture, member = true): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test user",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: member
      ? [
          {
            membershipId: fixture.memberId,
            organizationId: fixture.organizationId,
            role: "manager",
          },
        ]
      : [],
  });

  const TestLayer = NotificationPreferenceRepository.layer.pipe(
    Layer.provide(Database.PgliteDatabaseLive)
  );

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))(
    "handlers",
    (it) => {
      it.effect("resolves every preference to on without stored rows", () =>
        Effect.gen(function* () {
          const handlers = yield* NotificationPreferenceRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const state = yield* handlers
            .NotificationPreferenceGet({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));

          expect(state).toEqual({
            pausedAll: false,
            categories: {
              new_feedback: true,
              post_status_changed: true,
              changelog_published: true,
            },
          });
        })
      );

      it.effect("persists one category off and leaves the others on", () =>
        Effect.gen(function* () {
          const handlers = yield* NotificationPreferenceRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const written = yield* handlers
            .NotificationPreferenceSet({
              organizationId: fixture.organizationId,
              target: "new_feedback",
              enabled: false,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(written.categories.new_feedback).toBe(false);
          expect(written.categories.post_status_changed).toBe(true);
          expect(written.pausedAll).toBe(false);

          const read = yield* handlers
            .NotificationPreferenceGet({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(read).toEqual(written);
        })
      );

      it.effect("keeps the master pause independent of category toggles", () =>
        Effect.gen(function* () {
          const handlers = yield* NotificationPreferenceRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const paused = yield* handlers
            .NotificationPreferenceSet({
              organizationId: fixture.organizationId,
              target: "all",
              enabled: false,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(paused.pausedAll).toBe(true);
          expect(paused.categories.changelog_published).toBe(true);

          const oneOff = yield* handlers
            .NotificationPreferenceSet({
              organizationId: fixture.organizationId,
              target: "changelog_published",
              enabled: false,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(oneOff.pausedAll).toBe(true);
          expect(oneOff.categories.changelog_published).toBe(false);
        })
      );

      it.effect(
        "re-enabling deletes the row so absence keeps one meaning",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const handlers = yield* NotificationPreferenceRpcHandlersEffect;
            const fixture = yield* makeFixture();

            yield* handlers
              .NotificationPreferenceSet({
                organizationId: fixture.organizationId,
                target: "post_status_changed",
                enabled: false,
              })
              .pipe(Effect.provideService(CurrentSession, session(fixture)));
            const restored = yield* handlers
              .NotificationPreferenceSet({
                organizationId: fixture.organizationId,
                target: "post_status_changed",
                enabled: true,
              })
              .pipe(Effect.provideService(CurrentSession, session(fixture)));
            expect(restored.categories.post_status_changed).toBe(true);

            const rows = yield* db
              .select({ id: schema.notificationPreferenceTable.id })
              .from(schema.notificationPreferenceTable)
              .where(
                and(
                  eq(
                    schema.notificationPreferenceTable.organizationId,
                    fixture.organizationId
                  ),
                  eq(schema.notificationPreferenceTable.userId, fixture.userId)
                )
              );
            expect(rows).toEqual([]);
          })
      );

      it.effect("refuses a caller without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* NotificationPreferenceRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const error = yield* Effect.flip(
            handlers
              .NotificationPreferenceSet({
                organizationId: fixture.organizationId,
                target: "all",
                enabled: false,
              })
              .pipe(
                Effect.provideService(CurrentSession, session(fixture, false))
              )
          );
          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("scopes rows to the calling member's own account", () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* NotificationPreferenceRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const otherUserId = `user_other_${fixture.organizationId}`;
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: `other_${fixture.organizationId}@example.com`,
            name: "Other user",
          });
          const otherRowId = yield* NotificationPreferenceId.generate;
          yield* db.insert(schema.notificationPreferenceTable).values({
            id: otherRowId,
            organizationId: fixture.organizationId,
            userId: otherUserId,
            channel: "email",
            category: "all",
            enabled: false,
            createdAt: now,
            updatedAt: now,
          });

          const read = yield* handlers
            .NotificationPreferenceGet({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));
          expect(read.pausedAll).toBe(false);
        })
      );
    }
  );
});
