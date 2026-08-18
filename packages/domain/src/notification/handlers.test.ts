import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { NotificationId, type LegidOf, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { NotificationRpcHandlersEffect } from "./handlers";
import { NotificationPolicy } from "./policies";
import { NotificationService } from "./service";

describe("NotificationRpcHandlers", () => {
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
      const now = new Date();
      yield* db
        .insert(schema.organizationTable)
        .values({
          id: organizationId,
          name: "Test organization",
          slug: organizationId,
          createdAt: now,
        });
      yield* db
        .insert(schema.userTable)
        .values({
          id: userId,
          email: `${organizationId}@example.com`,
          name: "Test user",
        });
      yield* db
        .insert(schema.memberTable)
        .values({
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

  const insertNotification = (
    fixture: Fixture,
    options: {
      createdAt?: Date;
      recipientMemberId?: string;
    } = {}
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* NotificationId.generate;
      yield* db.insert(schema.notificationTable).values({
        id,
        organizationId: fixture.organizationId,
        recipientMemberId: options.recipientMemberId ?? fixture.memberId,
        actorMemberId: null,
        kind: "feedback.commented",
        resourceType: "comment",
        resourceId: "comment_1",
        title: "New comment",
        body: "Feedback title",
        href: `/${fixture.organizationId}/post/board/post#comment-comment_1`,
        deduplicationKey: `test:${id}`,
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      });
      return id;
    });

  const addMember = (fixture: Fixture) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const userId = `user_second_${fixture.organizationId}`;
      const memberId = `member_second_${fixture.organizationId}`;
      yield* db
        .insert(schema.userTable)
        .values({
          id: userId,
          email: `${userId}@example.com`,
          name: "Second user",
        });
      yield* db
        .insert(schema.memberTable)
        .values({
          id: memberId,
          organizationId: fixture.organizationId,
          userId,
          role: "manager",
          createdAt: new Date(),
        });
      return { ...fixture, memberId, userId } satisfies Fixture;
    });

  const TestLayer = Layer.mergeAll(
    NotificationService.layer,
    NotificationPolicy.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))(
    "handlers",
    (it) => {
      it.effect("lists and marks only the current member's notifications", () =>
        Effect.gen(function* () {
          const handlers = yield* NotificationRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const id = yield* insertNotification(fixture);
          const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(
              Effect.provideService(CurrentSession, session(fixture))
            );

          expect(
            yield* scoped(
              handlers.NotificationUnreadCount({
                organizationId: fixture.organizationId,
              })
            )
          ).toEqual({ count: 1 });
          expect(
            yield* scoped(
              handlers.NotificationList({
                organizationId: fixture.organizationId,
              })
            )
          ).toMatchObject([{ id, readAt: null }]);
          yield* scoped(
            handlers.NotificationMarkRead({
              organizationId: fixture.organizationId,
              notificationId: id,
            })
          );
          expect(
            yield* scoped(
              handlers.NotificationUnreadCount({
                organizationId: fixture.organizationId,
              })
            )
          ).toEqual({ count: 0 });
        })
      );

      it.effect(
        "denies notification access outside the current membership",
        () =>
          Effect.gen(function* () {
            const handlers = yield* NotificationRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const error = yield* Effect.flip(
              handlers
                .NotificationList({ organizationId: fixture.organizationId })
                .pipe(
                  Effect.provideService(CurrentSession, session(fixture, false))
                )
            );
            expect(error._tag).toBe("PolicyDenied");
          })
      );

      it.effect(
        "marks every unread notification read without changing another member's inbox",
        () =>
          Effect.gen(function* () {
            const handlers = yield* NotificationRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const otherMember = yield* addMember(fixture);
            yield* insertNotification(fixture);
            yield* insertNotification(fixture);
            yield* insertNotification(fixture, {
              recipientMemberId: otherMember.memberId,
            });
            const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
              effect.pipe(
                Effect.provideService(CurrentSession, session(fixture))
              );
            const otherScoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
              effect.pipe(
                Effect.provideService(CurrentSession, session(otherMember))
              );

            yield* scoped(
              handlers.NotificationMarkAllRead({
                organizationId: fixture.organizationId,
              })
            );
            expect(
              yield* scoped(
                handlers.NotificationUnreadCount({
                  organizationId: fixture.organizationId,
                })
              )
            ).toEqual({ count: 0 });
            expect(
              yield* otherScoped(
                handlers.NotificationUnreadCount({
                  organizationId: fixture.organizationId,
                })
              )
            ).toEqual({ count: 1 });
          })
      );

      it.effect(
        "paginates newest-first and never exposes another member's notification",
        () =>
          Effect.gen(function* () {
            const handlers = yield* NotificationRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const otherMember = yield* addMember(fixture);
            const oldest = yield* insertNotification(fixture, {
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
            });
            const newest = yield* insertNotification(fixture, {
              createdAt: new Date("2026-01-01T00:02:00.000Z"),
            });
            yield* insertNotification(fixture, {
              recipientMemberId: otherMember.memberId,
              createdAt: new Date("2026-01-01T00:03:00.000Z"),
            });
            const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
              effect.pipe(
                Effect.provideService(CurrentSession, session(fixture))
              );

            const firstPage = yield* scoped(
              handlers.NotificationList({
                organizationId: fixture.organizationId,
                limit: 1,
              })
            );
            expect(firstPage).toMatchObject([{ id: newest }]);
            const secondPage = yield* scoped(
              handlers.NotificationList({
                organizationId: fixture.organizationId,
                cursor: firstPage[0]!.createdAt,
                limit: 1,
              })
            );
            expect(secondPage).toMatchObject([{ id: oldest }]);
          })
      );

      it.effect("does not mark another member's notification as read", () =>
        Effect.gen(function* () {
          const handlers = yield* NotificationRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const otherMember = yield* addMember(fixture);
          const otherId = yield* insertNotification(fixture, {
            recipientMemberId: otherMember.memberId,
          });
          const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(
              Effect.provideService(CurrentSession, session(fixture))
            );
          const otherScoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(
              Effect.provideService(CurrentSession, session(otherMember))
            );

          yield* scoped(
            handlers.NotificationMarkRead({
              organizationId: fixture.organizationId,
              notificationId: otherId,
            })
          );
          expect(
            yield* otherScoped(
              handlers.NotificationUnreadCount({
                organizationId: fixture.organizationId,
              })
            )
          ).toEqual({ count: 1 });
        })
      );
    }
  );
});
