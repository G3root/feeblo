import { NodeCrypto } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, PostStatusId, WorkspaceId } from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { eq, inArray } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BoardRepository } from "../board/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { ResolvePrincipalService } from "../identity/service";
import { NotificationService } from "../notification/service";
import { PostActivityRepository } from "../post-activity/repository";
import { PostStatusRepository } from "../post-status/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { PostEmbeddingService } from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import { S3Test } from "../services/s3-test";
import { CurrentSession, type Session } from "../session-middleware";
import { TagRepository } from "../tag/repository";
import { UserRepository } from "../user/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { DataImportService } from "./import-service";
import { DataTransferRepository } from "./repository";
import { runDataImportPass } from "./worker";

const recordedIntegrationEvents: unknown[] = [];

const makeFixture = () =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const boardId = yield* BoardId.generate;
    const statusId = yield* PostStatusId.generate;
    const userId = `user_${organizationId}`;
    const userEmail = `${organizationId}@example.com`;
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
      email: userEmail,
      name: "Staff Actor",
      emailVerified: true,
    });
    yield* db.insert(schema.memberTable).values({
      id: membershipId,
      organizationId,
      userId,
      role: "manager",
      createdAt: now,
    });
    yield* db.insert(schema.boardTable).values({
      id: boardId,
      name: "Test board",
      slug: "test-board",
      visibility: "PUBLIC",
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
      userEmail,
      userId,
    };
  });

const makeSession = (
  fixture: Effect.Success<ReturnType<typeof makeFixture>>
): Session => ({
  user: {
    id: fixture.userId,
    email: fixture.userEmail,
    name: "Staff Actor",
    restrictedToOrganizationId: null,
  },
  session: { userId: fixture.userId, token: "test-token" },
  organizations: [{ id: fixture.organizationId }],
  memberships: [
    {
      membershipId: fixture.membershipId,
      organizationId: fixture.organizationId,
      role: "manager",
    },
  ],
});

const Repositories = Layer.mergeAll(
  BoardRepository.layer,
  PostRepository.layer,
  PostActivityRepository.layer,
  PostSubscriptionRepository.layer,
  EmailOutboxRepository.layer,
  EmailSubscriptionRepository.layerWithoutDependencies.pipe(
    Layer.provide(
      EmailSubscriptionTokenService.layerTest("data-transfer-test-secret")
    )
  ),
  ResolvePrincipalService.layer,
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
  UserRepository.layer,
  WorkspaceRepository.layer
);

const RepositoriesTest = Layer.mergeAll(
  Repositories,
  TagRepository.layer,
  PostStatusRepository.layer,
  DataTransferRepository.layer,
  // The post write path reads both optionally; `serviceOption` still requires
  // the tag to be present in the environment, the same as the server's
  // `PostWriteInternals` merge.
  PostEmbeddingService.layer,
  NotificationService.layer
);

// One `Database.PgliteDatabaseLive` acquisition for the whole graph: PGlite is
// a single writer, so a second instance over the same directory deadlocks.
const TestLayer = Layer.mergeAll(
  RepositoriesTest,
  DataImportService.layer,
  S3Test,
  EmailOutboxConfig.layerTest(new URL("https://feeblo.test")),
  Layer.succeed(
    IntegrationEventRecorder,
    IntegrationEventRecorder.of({
      recordIntegrationEvent: ({ event }) =>
        Effect.sync(() => {
          recordedIntegrationEvents.push(event);
        }).pipe(Effect.as({ deliveryCount: 0, eventRecorded: false })),
    })
  )
).pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive),
  Layer.provideMerge(NodeCrypto.layer)
);

const stageAndConfirm = (
  fixture: Effect.Success<ReturnType<typeof makeFixture>>,
  csv: string
) =>
  Effect.gen(function* () {
    const service = yield* DataImportService;
    const session = Effect.provideService(CurrentSession, makeSession(fixture));
    const job = yield* service
      .stageBoardImport({
        boardId: fixture.boardId,
        bytes: new TextEncoder().encode(csv),
        fileName: "posts.csv",
        memberId: fixture.membershipId,
        organizationId: fixture.organizationId,
        userId: fixture.userId,
      })
      .pipe(session);
    yield* service
      .confirmImport({
        id: job.id,
        organizationId: fixture.organizationId,
      })
      .pipe(session);
    return job;
  });
const claim = (leaseOwner: string) =>
  Effect.gen(function* () {
    const repository = yield* DataTransferRepository;
    const claimed = yield* repository.claimNextJob({
      leaseDurationMs: 60_000,
      leaseOwner,
    });
    return yield* Option.match(claimed, {
      onNone: () =>
        Effect.die("Expected the staged job to be claimable in this test."),
      onSome: (value) => Effect.succeed(value),
    });
  });

layer(TestLayer)("DataImportWorker", (it) => {
  it.effect(
    "applies a staged import and records nothing a live change would",
    () =>
      Effect.gen(function* () {
        recordedIntegrationEvents.length = 0;
        const fixture = yield* makeFixture();
        const job = yield* stageAndConfirm(
          fixture,
          [
            "title,content,status,tags,eta,author_name,author_email,created_at",
            "First post,Body one,Pending,Bug;Feature,2026-Q1,Jane,jane@example.com,2026-01-02T03:04:05Z",
            "Second post,Body two,Unknown status,,,,",
          ].join("\n")
        );

        const outcome = yield* runDataImportPass(yield* claim("worker-1"));
        expect(outcome).toMatchObject({
          createdCount: 2,
          errorCount: 0,
          jobId: job.id,
        });

        const db = yield* currentDb;
        const posts = yield* db
          .select()
          .from(schema.postTable)
          .where(eq(schema.postTable.organizationId, fixture.organizationId));
        expect(posts).toHaveLength(2);
        const first = posts.find((post) => post.title === "First post");
        expect(first).toMatchObject({
          boardId: fixture.boardId,
          source: "IMPORT",
        });
        expect(first?.contactId).not.toBeNull();
        expect(first?.creatorId).toBeNull();
        expect(first?.createdAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");

        const tags = yield* db
          .select()
          .from(schema.tagTable)
          .where(eq(schema.tagTable.organizationId, fixture.organizationId));
        expect(tags.map((tag) => tag.name).sort()).toEqual(["Bug", "Feature"]);
        const links = yield* db
          .select()
          .from(schema.postTagTable)
          .where(eq(schema.postTagTable.postId, first?.id ?? "missing-post"));
        expect(links).toHaveLength(2);

        const contacts = yield* db
          .select()
          .from(schema.contactTable)
          .where(
            eq(schema.contactTable.organizationId, fixture.organizationId)
          );
        // Provenance lives on the post (`source: "IMPORT"`). The contact is
        // created by the shared identity resolver, whose `source` column is
        // not part of its input contract.
        expect(contacts).toMatchObject([
          { email: "jane@example.com", name: "Jane" },
        ]);

        const activities = yield* db
          .select()
          .from(schema.postActivityTable)
          .where(
            inArray(
              schema.postActivityTable.postId,
              posts.map((post) => post.id)
            )
          );
        expect(activities).toHaveLength(2);
        expect(
          activities.every(
            (activity) =>
              activity.kind === "POST_CREATED" &&
              activity.actorId === fixture.userId
          )
        ).toBe(true);

        // The backfill suppresses every person-shaped side effect: no
        // integration event, no email intent, no subscription, no in-app
        // notification.
        expect(recordedIntegrationEvents).toEqual([]);
        const outbox = yield* db
          .select()
          .from(schema.emailOutboxTable)
          .where(
            eq(schema.emailOutboxTable.organizationId, fixture.organizationId)
          );
        expect(outbox).toEqual([]);
        const subscriptions = yield* db
          .select()
          .from(schema.postSubscriptionTable)
          .where(
            eq(
              schema.postSubscriptionTable.organizationId,
              fixture.organizationId
            )
          );
        expect(subscriptions).toEqual([]);
        const notifications = yield* db
          .select()
          .from(schema.notificationTable)
          .where(
            eq(schema.notificationTable.organizationId, fixture.organizationId)
          );
        expect(notifications).toEqual([]);

        const repository = yield* DataTransferRepository;
        const stored = yield* repository.findJob({
          id: job.id,
          organizationId: fixture.organizationId,
        });
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.status).toBe("completed");
          expect(stored.value.createdCount).toBe(2);
          expect(stored.value.warningCount).toBe(1);
        }
      })
  );

  it.effect("re-running a pass never creates a post twice", () =>
    Effect.gen(function* () {
      recordedIntegrationEvents.length = 0;
      const fixture = yield* makeFixture();
      yield* stageAndConfirm(fixture, "title\nOnly post\n");
      const claimOne = yield* claim("worker-1");
      yield* runDataImportPass(claimOne);

      const repository = yield* DataTransferRepository;
      const db = yield* currentDb;
      // Put the job back into `running` as a crashed-and-requeued attempt
      // would, then run the pass again: the ledger is the checkpoint.
      const now = yield* DateTime.nowAsDate;
      yield* db
        .update(schema.dataImportJobTable)
        .set({
          leaseExpiresAt: DateTime.fromDateUnsafe(now).pipe(
            DateTime.addDuration(Duration.minutes(1)),
            DateTime.toDate
          ),
          leaseOwner: "worker-2",
          status: "running",
        })
        .where(eq(schema.dataImportJobTable.id, claimOne.job.id));
      const stored = yield* repository.findJob({
        id: claimOne.job.id,
        organizationId: fixture.organizationId,
      });
      if (Option.isNone(stored)) {
        throw new Error("Expected the job to exist.");
      }
      yield* runDataImportPass({ job: stored.value, leaseOwner: "worker-2" });

      const posts = yield* db
        .select()
        .from(schema.postTable)
        .where(eq(schema.postTable.organizationId, fixture.organizationId));
      expect(posts).toHaveLength(1);
    })
  );

  it.effect("a canceled job stops before applying its pending rows", () =>
    Effect.gen(function* () {
      recordedIntegrationEvents.length = 0;
      const fixture = yield* makeFixture();
      const job = yield* stageAndConfirm(fixture, "title\nNever applied\n");
      const claimed = yield* claim("worker-1");
      const repository = yield* DataTransferRepository;
      yield* repository.cancelJob({
        id: job.id,
        organizationId: fixture.organizationId,
      });

      yield* runDataImportPass(claimed);

      const db = yield* currentDb;
      const posts = yield* db
        .select()
        .from(schema.postTable)
        .where(eq(schema.postTable.organizationId, fixture.organizationId));
      expect(posts).toEqual([]);
    })
  );
});
