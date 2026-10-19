import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BoardRepository } from "../board/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { grantStarterPlan } from "../entitlement/test-harness";
import { ResolvePrincipalService } from "../identity/service";
import { PostActivityRepository } from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { S3Test } from "../services/s3-test";
import { UserRepository } from "../user/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { PostRepository } from "./repository";
import { PostWriteService, type PostWriteActor } from "./write";

/**
 * The write path's own interface, driven directly.
 *
 * Every other suite reaches a create or update through a surface's handlers;
 * these tests cross the service the composition root provides, so the
 * consequences the path owns — the timeline, the creator's subscription, the
 * submission window, the integration event — and the actor branches are
 * asserted without a route in front of them.
 */
describe("PostWriteService", () => {
  const recordedIntegrationEvents: unknown[] = [];

  type Fixture = {
    readonly boardId: LegidOf<"BoardId">;
    readonly membershipId: string;
    readonly organizationId: LegidOf<"WorkspaceId">;
    readonly statusId: LegidOf<"PostStatusId">;
    readonly userId: string;
  };

  const makeFixture = (visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const boardId = yield* BoardId.generate;
      const statusId = yield* PostStatusId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
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
        name: "Test board",
        slug: boardId,
        visibility,
        organizationId,
        creatorId: userId,
        creatorMemberId: membershipId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId,
      });

      return {
        boardId,
        membershipId,
        organizationId,
        statusId,
        userId,
      } satisfies Fixture;
    });

  const memberActor = (fixture: Fixture): PostWriteActor => ({
    email: `${fixture.organizationId}@example.com`,
    kind: "member",
    memberId: fixture.membershipId,
    name: "Test User",
    userId: fixture.userId,
  });

  const addStatus = (
    fixture: Fixture,
    type: "PENDING" | "IN_PROGRESS" | "COMPLETED" = "COMPLETED"
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* PostStatusId.generate;
      yield* db.insert(schema.postStatusTable).values({
        id,
        type,
        orderIndex: 1,
        organizationId: fixture.organizationId,
      });
      return id;
    });

  /**
   * A public board created `days` after the fixture's own, so the fixture
   * stays the oldest keeper and the later boards can fall beyond the free
   * plan's limit.
   */
  const addBoardAt = (fixture: Fixture, days: number) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* BoardId.generate;
      const createdAt = DateTime.toDateUtc(
        DateTime.addDuration(
          DateTime.fromDateUnsafe(yield* DateTime.nowAsDate),
          Duration.days(days)
        )
      );

      yield* db.insert(schema.boardTable).values({
        id,
        name: `Board ${id}`,
        slug: id,
        visibility: "PUBLIC",
        organizationId: fixture.organizationId,
        createdAt,
        updatedAt: createdAt,
      });

      return { createdAt, id };
    });

  const IntegrationEventRecorderTest = Layer.succeed(
    IntegrationEventRecorder,
    IntegrationEventRecorder.of({
      recordIntegrationEvent: ({ event }) =>
        Effect.sync(() => {
          recordedIntegrationEvents.push(event);
        }).pipe(Effect.as({ deliveryCount: 0, eventRecorded: false })),
    })
  );

  const RepositoriesTest = Layer.mergeAll(
    BoardRepository.layer,
    PostRepository.layer,
    PostActivityRepository.layer,
    PostSubscriptionRepository.layer,
    EmailOutboxRepository.layer,
    EmailSubscriptionRepository.layerWithoutDependencies.pipe(
      Layer.provide(
        EmailSubscriptionTokenService.layerTest(
          "post-write-test-signing-secret"
        )
      )
    ),
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
    ResolvePrincipalService.layer,
    UserRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const RuntimeTest = Layer.mergeAll(
    Database.PgliteDatabaseLive,
    NodeCrypto.layer,
    S3Test,
    EmailOutboxConfig.layerTest(new URL("https://feeblo.test")),
    IntegrationEventRecorderTest
  );

  const TestLayer = PostWriteService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(RepositoriesTest, RuntimeTest))
  );

  layer(TestLayer)("write path", (it) => {
    it.effect("creates a post with the consequences the path owns", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const writes = yield* PostWriteService;
        const db = yield* currentDb;
        const postId = yield* PostId.generate;
        recordedIntegrationEvents.length = 0;

        const slug = yield* writes.create(
          {
            assetIds: [],
            boardId: fixture.boardId,
            content: "Body",
            id: postId,
            organizationId: fixture.organizationId,
            statusId: fixture.statusId,
            title: "Dark mode",
          },
          memberActor(fixture)
        );

        const [post] = yield* db
          .select()
          .from(schema.postTable)
          .where(eq(schema.postTable.id, postId));
        expect(post?.slug).toBe(slug);
        expect(post?.title).toBe("Dark mode");
        expect(post?.creatorId).toBe(fixture.userId);
        expect(post?.creatorMemberId).toBe(fixture.membershipId);

        // The timeline entry the dashboard reads.
        const activity = yield* db
          .select({ kind: schema.postActivityTable.kind })
          .from(schema.postActivityTable)
          .where(eq(schema.postActivityTable.postId, postId));
        expect(activity.map(({ kind }) => kind)).toEqual(["POST_CREATED"]);

        // The creator's own watch-list subscription.
        const subscriptions = yield* db
          .select()
          .from(schema.postSubscriptionTable)
          .where(eq(schema.postSubscriptionTable.postId, postId));
        expect(subscriptions).toHaveLength(1);
        expect(subscriptions[0]?.userId).toBe(fixture.userId);

        // The submission email window, recorded even though this composition
        // omits the queue that would wake its worker.
        const outbox = yield* db
          .select({ kind: schema.emailOutboxTable.kind })
          .from(schema.emailOutboxTable)
          .where(
            eq(schema.emailOutboxTable.organizationId, fixture.organizationId)
          );
        expect(outbox.map(({ kind }) => kind)).toEqual(["submission.created"]);

        // The webhook fact, recorded even though this composition omits the
        // notification and embedding services the path treats as optional.
        expect(recordedIntegrationEvents).toEqual([
          expect.objectContaining({ type: "post.created" }),
        ]);
      })
    );

    it.effect(
      "lets a machine key write to a private board with nobody to subscribe",
      () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture("PRIVATE");
          // A private board is a paid capability: on free it is read-only by
          // the plan lock, and this test is about a machine key's attribution
          // on a writable board.
          yield* grantStarterPlan(fixture.organizationId);
          const writes = yield* PostWriteService;
          const db = yield* currentDb;
          const postId = yield* PostId.generate;
          recordedIntegrationEvents.length = 0;

          yield* writes.create(
            {
              assetIds: [],
              boardId: fixture.boardId,
              content: "Body",
              id: postId,
              organizationId: fixture.organizationId,
              statusId: fixture.statusId,
              title: "Machine post",
            },
            { kind: "api_key" }
          );

          const [post] = yield* db
            .select()
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(post?.title).toBe("Machine post");
          // A key identifies the workspace, never a person: nobody is
          // attributed and nobody is watch-listed.
          expect(post?.creatorId).toBeNull();
          expect(post?.creatorMemberId).toBeNull();

          const subscriptions = yield* db
            .select()
            .from(schema.postSubscriptionTable)
            .where(eq(schema.postSubscriptionTable.postId, postId));
          expect(subscriptions).toHaveLength(0);
          expect(recordedIntegrationEvents).toEqual([
            expect.objectContaining({ type: "post.created" }),
          ]);
        })
    );

    it.effect(
      "attributes an inbound machine-key create without subscribing its author",
      () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture("PRIVATE");
          yield* grantStarterPlan(fixture.organizationId);
          const writes = yield* PostWriteService;
          const db = yield* currentDb;
          const postId = yield* PostId.generate;
          recordedIntegrationEvents.length = 0;

          yield* writes.create(
            {
              assetIds: [],
              boardId: fixture.boardId,
              content: "Body",
              id: postId,
              organizationId: fixture.organizationId,
              statusId: fixture.statusId,
              title: "Inbound post",
            },
            { kind: "api_key" },
            { creatorUserId: fixture.userId }
          );

          const [post] = yield* db
            .select()
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          // The post is attributed to the inbound author so creator-based
          // reads and edit/delete permissions work.
          expect(post?.creatorId).toBe(fixture.userId);

          // A post made in chat does not put its author on the watch-list.
          const subscriptions = yield* db
            .select()
            .from(schema.postSubscriptionTable)
            .where(eq(schema.postSubscriptionTable.postId, postId));
          expect(subscriptions).toHaveLength(0);
        })
    );

    it.effect("records an update only for the fields that changed", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const writes = yield* PostWriteService;
        const db = yield* currentDb;
        const postId = yield* PostId.generate;
        const nextStatusId = yield* addStatus(fixture);
        recordedIntegrationEvents.length = 0;

        yield* writes.create(
          {
            assetIds: [],
            boardId: fixture.boardId,
            content: "Body",
            id: postId,
            organizationId: fixture.organizationId,
            statusId: fixture.statusId,
            title: "Dark mode",
          },
          memberActor(fixture)
        );
        recordedIntegrationEvents.length = 0;

        yield* writes.update(
          {
            id: postId,
            organizationId: fixture.organizationId,
            statusId: nextStatusId,
            title: "Dark mode v2",
          },
          memberActor(fixture)
        );

        const [post] = yield* db
          .select()
          .from(schema.postTable)
          .where(eq(schema.postTable.id, postId));
        expect(post?.title).toBe("Dark mode v2");
        expect(post?.statusId).toBe(nextStatusId);

        const activity = yield* db
          .select({ kind: schema.postActivityTable.kind })
          .from(schema.postActivityTable)
          .where(eq(schema.postActivityTable.postId, postId));
        expect(activity.map(({ kind }) => kind)).toEqual(
          expect.arrayContaining(["TITLE_CHANGED", "STATUS_CHANGED"])
        );

        expect(recordedIntegrationEvents).toEqual([
          expect.objectContaining({ type: "post.status_changed" }),
        ]);
      })
    );

    it.effect("refuses an update to a post on a locked board", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const writes = yield* PostWriteService;
        const db = yield* currentDb;
        const postId = yield* PostId.generate;

        yield* addBoardAt(fixture, 1);
        const locked = yield* addBoardAt(fixture, 2);

        yield* db.insert(schema.postTable).values({
          id: postId,
          boardId: locked.id,
          organizationId: fixture.organizationId,
          title: "Locked post",
          content: "Body",
          slug: postId,
          statusId: fixture.statusId,
          createdAt: locked.createdAt,
          updatedAt: locked.createdAt,
        });

        const error = yield* Effect.flip(
          writes.update(
            {
              id: postId,
              organizationId: fixture.organizationId,
              title: "Locked post v2",
            },
            memberActor(fixture)
          )
        );

        expect(error._tag).toBe("PlanLockedError");
      })
    );

    it.effect("refuses a merge when either post's board is locked", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const writes = yield* PostWriteService;
        const db = yield* currentDb;

        yield* addBoardAt(fixture, 1);
        const locked = yield* addBoardAt(fixture, 2);

        const keptPostId = yield* PostId.generate;
        const lockedPostId = yield* PostId.generate;
        yield* writes.create(
          {
            assetIds: [],
            boardId: fixture.boardId,
            content: "Body",
            id: keptPostId,
            organizationId: fixture.organizationId,
            statusId: fixture.statusId,
            title: "Kept post",
          },
          memberActor(fixture)
        );
        yield* db.insert(schema.postTable).values({
          id: lockedPostId,
          boardId: locked.id,
          organizationId: fixture.organizationId,
          title: "Locked post",
          content: "Body",
          slug: lockedPostId,
          statusId: fixture.statusId,
          createdAt: locked.createdAt,
          updatedAt: locked.createdAt,
        });

        const sourceError = yield* Effect.flip(
          writes.merge(
            {
              organizationId: fixture.organizationId,
              sourcePostId: lockedPostId,
              targetPostId: keptPostId,
            },
            memberActor(fixture)
          )
        );
        expect(sourceError._tag).toBe("PlanLockedError");

        const targetError = yield* Effect.flip(
          writes.merge(
            {
              organizationId: fixture.organizationId,
              sourcePostId: keptPostId,
              targetPostId: lockedPostId,
            },
            memberActor(fixture)
          )
        );
        expect(targetError._tag).toBe("PlanLockedError");
      })
    );

    it.effect(
      "refuses an unmerge when either post's board is locked and keeps the not-merged error",
      () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const writes = yield* PostWriteService;
          const db = yield* currentDb;
          const now = yield* DateTime.nowAsDate;

          yield* addBoardAt(fixture, 1);
          const locked = yield* addBoardAt(fixture, 2);

          const insertPost = (args: {
            readonly boardId: string;
            readonly createdAt: Date;
            readonly id: string;
            readonly mergedIntoPostId?: string | undefined;
          }) =>
            db.insert(schema.postTable).values({
              id: args.id,
              boardId: args.boardId,
              organizationId: fixture.organizationId,
              title: `Post ${args.id}`,
              content: "Body",
              slug: args.id,
              statusId: fixture.statusId,
              createdAt: args.createdAt,
              updatedAt: args.createdAt,
              ...(args.mergedIntoPostId !== undefined && {
                archivedAt: args.createdAt,
                mergedAt: args.createdAt,
                mergedIntoPostId: args.mergedIntoPostId,
              }),
            });

          // Source on the locked board, target on a kept board.
          const keptTargetId = yield* PostId.generate;
          const lockedSourceId = yield* PostId.generate;
          yield* insertPost({
            boardId: fixture.boardId,
            createdAt: now,
            id: keptTargetId,
          });
          yield* insertPost({
            boardId: locked.id,
            createdAt: locked.createdAt,
            id: lockedSourceId,
            mergedIntoPostId: keptTargetId,
          });

          const sourceError = yield* Effect.flip(
            writes.unmerge(
              {
                organizationId: fixture.organizationId,
                sourcePostId: lockedSourceId,
              },
              memberActor(fixture)
            )
          );
          expect(sourceError._tag).toBe("PlanLockedError");

          // Source on a kept board, target on the locked board.
          const keptSourceId = yield* PostId.generate;
          const lockedTargetId = yield* PostId.generate;
          yield* insertPost({
            boardId: locked.id,
            createdAt: locked.createdAt,
            id: lockedTargetId,
          });
          yield* insertPost({
            boardId: fixture.boardId,
            createdAt: now,
            id: keptSourceId,
            mergedIntoPostId: lockedTargetId,
          });

          const targetError = yield* Effect.flip(
            writes.unmerge(
              {
                organizationId: fixture.organizationId,
                sourcePostId: keptSourceId,
              },
              memberActor(fixture)
            )
          );
          expect(targetError._tag).toBe("PlanLockedError");

          // A source that is not merged has no target to check, so it keeps
          // the repository's existing refusal.
          const plainPostId = yield* PostId.generate;
          yield* insertPost({
            boardId: fixture.boardId,
            createdAt: now,
            id: plainPostId,
          });

          const notMergedError = yield* Effect.flip(
            writes.unmerge(
              {
                organizationId: fixture.organizationId,
                sourcePostId: plainPostId,
              },
              memberActor(fixture)
            )
          );
          expect(notMergedError._tag).toBe("FailedToMergePostError");
        })
    );
  });
});
