import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  PostStatusId,
  RoadmapColumnId,
  RoadmapId,
  WorkspaceId,
} from "@feeblo/id";
import type { Role } from "@feeblo/permissions";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { PostStatusRpcHandlersEffect } from "./handlers";
import { PostStatusRepository } from "./repository";

describe("PostStatusRpcHandlers", () => {
  type Fixture = {
    boardId: string;
    membershipId: string;
    organizationId: string;
    roadmapId: string;
    userId: string;
  };

  const makeSession = (
    fixture: Fixture,
    role: Role | null = "owner"
  ): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships:
      role === null
        ? []
        : [
            {
              membershipId: fixture.membershipId,
              organizationId: fixture.organizationId,
              role,
            },
          ],
  });

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const roadmapId = yield* RoadmapId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
      const boardId = `board_${organizationId}`;
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
        name: "Test User",
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Feedback",
        slug: `feedback-${organizationId}`,
        visibility: "PUBLIC",
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.roadmapTable).values({
        id: roadmapId,
        name: "Roadmap",
        slug: `roadmap-${organizationId}`,
        mode: "status",
        visibility: "public",
        filter: { version: 1, operator: "and", conditions: [] },
        organizationId,
        createdAt: now,
        updatedAt: now,
      });

      return { boardId, membershipId, organizationId, roadmapId, userId };
    });

  /** Inserts a status row and returns its id. */
  const insertStatus = (
    fixture: Fixture,
    status: {
      isDefault?: boolean;
      label?: string;
      orderIndex: number;
      type:
        | "CLOSED"
        | "COMPLETED"
        | "IN_PROGRESS"
        | "PENDING"
        | "PLANNED"
        | "REVIEW";
    }
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* PostStatusId.generate;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.postStatusTable).values({
        id,
        organizationId: fixture.organizationId,
        type: status.type,
        label: status.label ?? status.type,
        orderIndex: status.orderIndex,
        isDefault: status.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      });

      return id;
    });

  const insertPost = (fixture: Fixture, statusId: string, slug: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.postTable).values({
        id: `post_${fixture.organizationId}_${slug}`,
        title: slug,
        slug: `${slug}-${fixture.organizationId}`,
        content: "<p>body</p>",
        boardId: fixture.boardId,
        statusId,
        organizationId: fixture.organizationId,
        createdAt: now,
        updatedAt: now,
      });
    });

  const TestLayer = Layer.merge(
    PostStatusRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    Database.PgliteDatabaseLive
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
          {
            id: laterId,
            type: "COMPLETED",
            orderIndex: 1,
            organizationId: fixture.organizationId,
          },
          {
            id: firstId,
            type: "PENDING",
            orderIndex: 0,
            organizationId: fixture.organizationId,
          },
        ]);

        const statuses = yield* handlers
          .PostStatusList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        expect(statuses.map((status) => status.id)).toEqual([firstId, laterId]);
      })
    );

    it.effect("rejects non-members from listing statuses", () =>
      Effect.gen(function* () {
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers
            .PostStatusList({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            )
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("lists statuses publicly without a session", () =>
      Effect.gen(function* () {
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const statusId = yield* insertStatus(fixture, {
          isDefault: true,
          orderIndex: 0,
          type: "PENDING",
        });

        const statuses = yield* handlers.PostStatusListPublic({
          organizationId: fixture.organizationId,
        });

        expect(statuses).toHaveLength(1);
        expect(statuses[0]).toMatchObject({
          id: statusId,
          isDefault: true,
          type: "PENDING",
        });
      })
    );

    it.effect("previews what deleting a status would touch", () =>
      Effect.gen(function* () {
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* insertStatus(fixture, {
          isDefault: true,
          orderIndex: 0,
          type: "PENDING",
        });
        const doomedId = yield* insertStatus(fixture, {
          orderIndex: 1,
          type: "REVIEW",
        });
        const now = yield* DateTime.nowAsDate;
        const db = yield* currentDb;

        yield* insertPost(fixture, doomedId, "first");
        yield* insertPost(fixture, doomedId, "second");

        yield* db.insert(schema.roadmapColumnTable).values({
          id: yield* RoadmapColumnId.generate,
          roadmapId: fixture.roadmapId,
          name: "In Review",
          position: 0,
          config: { type: "status", statusId: doomedId },
          createdAt: now,
          updatedAt: now,
        });

        const preview = yield* handlers
          .PostStatusDeletePreview({
            id: doomedId,
            organizationId: fixture.organizationId,
          })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession(fixture, "manager")
            )
          );

        expect(preview).toEqual({
          postCount: 2,
          roadmapColumnCount: 1,
          syncRuleCount: 0,
        });
      })
    );

    it.effect("creates a status that is never the default", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const id = yield* PostStatusId.generate;

        yield* handlers
          .PostStatusCreate({
            id,
            organizationId: fixture.organizationId,
            type: "REVIEW",
            label: "In Review",
            color: "oklch(0.666 0.179 58.318)",
            orderIndex: 1,
          })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession(fixture, "manager")
            )
          );

        const [created] = yield* db
          .select()
          .from(schema.postStatusTable)
          .where(eq(schema.postStatusTable.id, id));

        expect(created).toMatchObject({
          id,
          isDefault: false,
          label: "In Review",
          type: "REVIEW",
        });
      })
    );

    it.effect("rejects a create whose position is already taken", () =>
      Effect.gen(function* () {
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* insertStatus(fixture, { orderIndex: 4, type: "REVIEW" });

        const error = yield* Effect.flip(
          handlers
            .PostStatusCreate({
              id: yield* PostStatusId.generate,
              organizationId: fixture.organizationId,
              type: "COMPLETED",
              label: "Shipped",
              color: null,
              orderIndex: 4,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            )
        );

        // A stale client, not a server fault: both values that can collide are
        // the caller's to choose.
        expect(error._tag).toBe("BadRequestError");
      })
    );

    it.effect("rejects a contributor creating a status", () =>
      Effect.gen(function* () {
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const id = yield* PostStatusId.generate;

        const error = yield* Effect.flip(
          handlers
            .PostStatusCreate({
              id,
              organizationId: fixture.organizationId,
              type: "REVIEW",
              label: "In Review",
              color: null,
              orderIndex: 1,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "contributor")
              )
            )
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("appends a status to its new section when its type changes", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const reviewId = yield* insertStatus(fixture, {
          orderIndex: 1,
          type: "REVIEW",
        });
        yield* insertStatus(fixture, { orderIndex: 4, type: "COMPLETED" });

        yield* handlers
          .PostStatusUpdate({
            id: reviewId,
            organizationId: fixture.organizationId,
            type: "COMPLETED",
            label: "Done",
            color: null,
          })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession(fixture, "manager")
            )
          );

        const [updated] = yield* db
          .select({
            orderIndex: schema.postStatusTable.orderIndex,
            type: schema.postStatusTable.type,
          })
          .from(schema.postStatusTable)
          .where(eq(schema.postStatusTable.id, reviewId));

        expect(updated).toEqual({ orderIndex: 5, type: "COMPLETED" });
      })
    );

    it.effect(
      "moves the default flag onto another status without moving posts",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* PostStatusRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const previousDefaultId = yield* insertStatus(fixture, {
            isDefault: true,
            orderIndex: 0,
            type: "PENDING",
          });
          const nextDefaultId = yield* insertStatus(fixture, {
            orderIndex: 1,
            type: "REVIEW",
          });

          yield* insertPost(fixture, previousDefaultId, "stays-put");

          yield* handlers
            .PostStatusMakeDefault({
              id: nextDefaultId,
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const statuses = yield* db
            .select({
              id: schema.postStatusTable.id,
              isDefault: schema.postStatusTable.isDefault,
            })
            .from(schema.postStatusTable)
            .where(
              eq(schema.postStatusTable.organizationId, fixture.organizationId)
            );

          const defaults = new Map(
            statuses.map((status) => [status.id, status.isDefault])
          );

          expect(defaults.get(previousDefaultId)).toBe(false);
          expect(defaults.get(nextDefaultId)).toBe(true);

          // The flag decides where the *next* post lands; the posts already in
          // the old default stay there.
          const posts = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.organizationId, fixture.organizationId));

          expect(posts).toEqual([{ statusId: previousDefaultId }]);
        })
    );

    it.effect("rejects a contributor making a status the default", () =>
      Effect.gen(function* () {
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* insertStatus(fixture, {
          isDefault: true,
          orderIndex: 0,
          type: "PENDING",
        });
        const nextDefaultId = yield* insertStatus(fixture, {
          orderIndex: 1,
          type: "REVIEW",
        });

        const error = yield* Effect.flip(
          handlers
            .PostStatusMakeDefault({
              id: nextDefaultId,
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "contributor")
              )
            )
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("refuses to delete the default status", () =>
      Effect.gen(function* () {
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const defaultId = yield* insertStatus(fixture, {
          isDefault: true,
          orderIndex: 0,
          type: "PENDING",
        });

        const error = yield* Effect.flip(
          handlers
            .PostStatusDelete({
              id: defaultId,
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            )
        );

        expect(error._tag).toBe("BadRequestError");
      })
    );

    it.effect(
      "moves a deleted status's posts to the default and reports the counts",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* PostStatusRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const defaultId = yield* insertStatus(fixture, {
            isDefault: true,
            orderIndex: 0,
            type: "PENDING",
          });
          const doomedId = yield* insertStatus(fixture, {
            orderIndex: 1,
            type: "REVIEW",
          });

          yield* insertPost(fixture, doomedId, "first");
          yield* insertPost(fixture, doomedId, "second");
          yield* insertPost(fixture, defaultId, "third");

          const result = yield* handlers
            .PostStatusDelete({
              id: doomedId,
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          expect(result).toEqual({
            movedPostCount: 2,
            removedRoadmapColumnCount: 0,
            removedSyncRuleCount: 0,
          });

          const remaining = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.organizationId, fixture.organizationId));

          expect(remaining.map((post) => post.statusId)).toEqual([
            defaultId,
            defaultId,
            defaultId,
          ]);

          const statuses = yield* db
            .select({ id: schema.postStatusTable.id })
            .from(schema.postStatusTable)
            .where(
              eq(schema.postStatusTable.organizationId, fixture.organizationId)
            );

          expect(statuses.map((status) => status.id)).toEqual([defaultId]);
        })
    );

    it.effect("removes roadmap columns bound to a deleted status", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const defaultId = yield* insertStatus(fixture, {
          isDefault: true,
          orderIndex: 0,
          type: "PENDING",
        });
        const doomedId = yield* insertStatus(fixture, {
          orderIndex: 1,
          type: "REVIEW",
        });
        const boundColumnId = yield* RoadmapColumnId.generate;
        const freeColumnId = yield* RoadmapColumnId.generate;
        const now = yield* DateTime.nowAsDate;

        yield* db.insert(schema.roadmapColumnTable).values([
          {
            id: boundColumnId,
            roadmapId: fixture.roadmapId,
            name: "In Review",
            position: 0,
            config: { type: "status", statusId: doomedId },
            createdAt: now,
            updatedAt: now,
          },
          {
            id: freeColumnId,
            roadmapId: fixture.roadmapId,
            name: "Pending",
            position: 1,
            config: { type: "status", statusId: defaultId },
            createdAt: now,
            updatedAt: now,
          },
        ]);

        const result = yield* handlers
          .PostStatusDelete({
            id: doomedId,
            organizationId: fixture.organizationId,
          })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession(fixture, "manager")
            )
          );

        expect(result.removedRoadmapColumnCount).toBe(1);

        const columns = yield* db
          .select({ id: schema.roadmapColumnTable.id })
          .from(schema.roadmapColumnTable)
          .where(eq(schema.roadmapColumnTable.roadmapId, fixture.roadmapId));

        expect(columns.map((column) => column.id)).toEqual([freeColumnId]);
      })
    );

    it.effect("reorders a section without disturbing other sections", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* PostStatusRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const firstReviewId = yield* insertStatus(fixture, {
          orderIndex: 1,
          type: "REVIEW",
        });
        const secondReviewId = yield* insertStatus(fixture, {
          orderIndex: 2,
          type: "REVIEW",
        });
        const completedId = yield* insertStatus(fixture, {
          orderIndex: 3,
          type: "COMPLETED",
        });

        yield* handlers
          .PostStatusReorder({
            organizationId: fixture.organizationId,
            type: "REVIEW",
            orderedIds: [secondReviewId, firstReviewId],
          })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession(fixture, "manager")
            )
          );

        const statuses = yield* db
          .select({
            id: schema.postStatusTable.id,
            orderIndex: schema.postStatusTable.orderIndex,
          })
          .from(schema.postStatusTable)
          .where(
            eq(schema.postStatusTable.organizationId, fixture.organizationId)
          );

        const byId = new Map(
          statuses.map((status) => [status.id, status.orderIndex])
        );

        // The two rows swapped the positions the section already owned, so the
        // COMPLETED row keeps the index it had.
        expect(byId.get(secondReviewId)).toBe(1);
        expect(byId.get(firstReviewId)).toBe(2);
        expect(byId.get(completedId)).toBe(3);
      })
    );

    it.effect(
      "rejects a reorder that does not name every status in the section",
      () =>
        Effect.gen(function* () {
          const handlers = yield* PostStatusRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const firstReviewId = yield* insertStatus(fixture, {
            orderIndex: 1,
            type: "REVIEW",
          });
          yield* insertStatus(fixture, { orderIndex: 2, type: "REVIEW" });

          const error = yield* Effect.flip(
            handlers
              .PostStatusReorder({
                organizationId: fixture.organizationId,
                type: "REVIEW",
                orderedIds: [firstReviewId],
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              )
          );

          expect(error._tag).toBe("BadRequestError");
        })
    );
  });
});
