import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PostTrafficRepository } from "./repository";

const TestLayer = PostTrafficRepository.layer.pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

const makeFixture = () =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;
    const boardId = `board_${organizationId}`;
    const statusId = `status_${organizationId}`;
    const postId = `post_${organizationId}`;

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Test organization",
      slug: organizationId,
      createdAt: now,
    });
    yield* db.insert(schema.boardTable).values({
      id: boardId,
      name: "Feedback",
      slug: "feedback",
      visibility: "PUBLIC",
      organizationId,
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.postStatusTable).values({
      id: statusId,
      type: "PENDING",
      label: "Pending",
      orderIndex: 0,
      isDefault: true,
      organizationId,
    });
    yield* db.insert(schema.postTable).values({
      id: postId,
      title: "Post",
      slug: "post",
      content: "Body",
      boardId,
      statusId,
      organizationId,
      createdAt: now,
      updatedAt: now,
    });

    return { boardId, organizationId, postId };
  });

const view = (
  postId: string,
  id: string,
  overrides: Partial<{
    browser: string;
    country: string;
    device: string;
    os: string;
  }> = {}
) => ({
  browser: "Chrome",
  country: "US",
  device: "desktop",
  id,
  os: "macOS",
  postId,
  ...overrides,
});

layer(TestLayer)("PostTrafficRepository", (it) => {
  describe("recordView", () => {
    it.effect("records a view and counts it once", () =>
      Effect.gen(function* () {
        const { organizationId, postId } = yield* makeFixture();
        const repository = yield* PostTrafficRepository;
        const now = yield* DateTime.now;

        expect(
          yield* repository.recordView(view(postId, `${postId}:view-1`))
        ).toBe(true);
        // The same id is a retried beacon, not a second view.
        expect(
          yield* repository.recordView(view(postId, `${postId}:view-1`))
        ).toBe(true);

        const traffic = yield* repository.getPostTraffic({
          organizationId,
          postId,
          since: DateTime.toDate(DateTime.subtract({ seconds: 1 })(now)),
        });

        expect(Option.isSome(traffic)).toBe(true);
        expect(Option.getOrThrow(traffic).views).toBe(1);
        expect(Option.getOrThrow(traffic).last30Days.views).toBe(1);
      })
    );

    it.effect("refuses a view of an archived post", () =>
      Effect.gen(function* () {
        const { organizationId, postId } = yield* makeFixture();
        const repository = yield* PostTrafficRepository;
        const db = yield* currentDb;
        const now = yield* DateTime.now;

        yield* db
          .update(schema.postTable)
          .set({ archivedAt: DateTime.toDate(now) })
          .where(eq(schema.postTable.id, postId));

        expect(
          yield* repository.recordView(view(postId, `${postId}:view-1`))
        ).toBe(false);

        const traffic = yield* repository.getPostTraffic({
          organizationId,
          postId,
          since: DateTime.toDate(DateTime.subtract({ seconds: 1 })(now)),
        });
        expect(Option.getOrThrow(traffic).views).toBe(0);
      })
    );

    it.effect("refuses a view of a post on a private board", () =>
      Effect.gen(function* () {
        const { boardId, postId } = yield* makeFixture();
        const repository = yield* PostTrafficRepository;
        const db = yield* currentDb;

        yield* db
          .update(schema.boardTable)
          .set({ visibility: "PRIVATE" })
          .where(eq(schema.boardTable.id, boardId));

        expect(
          yield* repository.recordView(view(postId, `${postId}:view-1`))
        ).toBe(false);
      })
    );
  });

  describe("getPostTraffic", () => {
    it.effect("breaks the window down by country and device", () =>
      Effect.gen(function* () {
        const { organizationId, postId } = yield* makeFixture();
        const repository = yield* PostTrafficRepository;
        const now = yield* DateTime.now;

        yield* repository.recordView(view(postId, `${postId}:view-1`));
        yield* repository.recordView(view(postId, `${postId}:view-2`));
        yield* repository.recordView(
          view(postId, `${postId}:view-3`, {
            country: "DE",
            device: "mobile",
          })
        );

        const traffic = Option.getOrThrow(
          yield* repository.getPostTraffic({
            organizationId,
            postId,
            since: DateTime.toDate(DateTime.subtract({ seconds: 1 })(now)),
          })
        );

        expect(traffic.views).toBe(3);
        expect(traffic.last30Days.countries[0]).toEqual({
          value: "US",
          views: 2,
        });
        expect(traffic.last30Days.countries[1]).toEqual({
          value: "DE",
          views: 1,
        });
        expect(traffic.last30Days.devices).toEqual([
          { value: "desktop", views: 2 },
          { value: "mobile", views: 1 },
        ]);
      })
    );

    it.effect("does not answer for another workspace's post", () =>
      Effect.gen(function* () {
        const first = yield* makeFixture();
        const second = yield* makeFixture();
        const repository = yield* PostTrafficRepository;
        const now = yield* DateTime.now;

        yield* repository.recordView(
          view(first.postId, `${first.postId}:view-1`)
        );

        const traffic = yield* repository.getPostTraffic({
          organizationId: second.organizationId,
          postId: first.postId,
          since: DateTime.toDate(DateTime.subtract({ seconds: 1 })(now)),
        });

        expect(Option.isNone(traffic)).toBe(true);
      })
    );

    it.effect(
      "prunes old events, keeps recent ones, and keeps the counter",
      () =>
        Effect.gen(function* () {
          const { organizationId, postId } = yield* makeFixture();
          const repository = yield* PostTrafficRepository;
          const db = yield* currentDb;
          const now = yield* DateTime.now;

          yield* repository.recordView(view(postId, `${postId}:view-1`));
          // A second event after the cutoff. Inserted directly because
          // `recordView` reads the clock, and the repository only owns the
          // deletion half of retention.
          yield* db.insert(schema.postViewEventTable).values({
            browser: "Chrome",
            country: "US",
            device: "desktop",
            id: `${postId}:recent`,
            occurredAt: DateTime.toDate(DateTime.add({ seconds: 10 })(now)),
            os: "macOS",
            postId,
          });

          yield* repository.deleteEventsBefore(
            DateTime.toDate(DateTime.add({ seconds: 5 })(now))
          );

          const remaining = yield* db
            .select({ id: schema.postViewEventTable.id })
            .from(schema.postViewEventTable)
            .where(eq(schema.postViewEventTable.postId, postId));

          expect(remaining).toEqual([{ id: `${postId}:recent` }]);

          const traffic = Option.getOrThrow(
            yield* repository.getPostTraffic({
              organizationId,
              postId,
              since: DateTime.toDate(DateTime.subtract({ seconds: 1 })(now)),
            })
          );

          // The counter is untouched by either event's age.
          expect(traffic.views).toBe(1);
          expect(traffic.last30Days.views).toBe(1);
        })
    );

    it.effect("drops the post's views when the post is deleted", () =>
      Effect.gen(function* () {
        const { organizationId, postId } = yield* makeFixture();
        const repository = yield* PostTrafficRepository;
        const db = yield* currentDb;
        const now = yield* DateTime.now;

        yield* repository.recordView(view(postId, `${postId}:view-1`));
        yield* db
          .delete(schema.postTable)
          .where(eq(schema.postTable.id, postId));

        const events = yield* db
          .select()
          .from(schema.postViewEventTable)
          .where(eq(schema.postViewEventTable.postId, postId));
        const totals = yield* db
          .select()
          .from(schema.postViewTotalTable)
          .where(eq(schema.postViewTotalTable.postId, postId));

        expect(events).toHaveLength(0);
        expect(totals).toHaveLength(0);
        expect(
          Option.isNone(
            yield* repository.getPostTraffic({
              organizationId,
              postId,
              since: DateTime.toDate(DateTime.subtract({ seconds: 1 })(now)),
            })
          )
        ).toBe(true);
      })
    );
  });
});
