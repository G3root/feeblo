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
import { PostActivityRepository } from "../post-activity/repository";
import { PostStatusRepository } from "../post-status/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { PostRepository } from "../post/repository";
import { PostWriteService } from "../post/write";
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

const PostWriteDependenciesTest = Layer.mergeAll(
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
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
  ResolvePrincipalService.layer,
  UserRepository.layer
).pipe(Layer.provide(Database.PgliteDatabaseLive));

const RuntimeTest = Layer.mergeAll(
  Database.PgliteDatabaseLive,
  NodeCrypto.layer,
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
);

// One built graph, mirroring the server's: the worker runs against the same
// `PostWriteService` the write path exposes, and the optional fan-outs it
// reads with `serviceOption` are simply absent (an import backfill skips them).
const TestLayer = Layer.mergeAll(
  BoardRepository.layer,
  PostWriteService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(PostWriteDependenciesTest, RuntimeTest))
  ),
  DataImportService.layer,
  DataTransferRepository.layer,
  TagRepository.layer,
  PostStatusRepository.layer
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
          // Both rows have an empty `board` cell, so both warn about the
          // fallback board; the second also has an unknown status.
          expect(stored.value.warningCount).toBe(2);
        }
      })
  );

  it.effect("routes rows to the board the file names and creates it", () =>
    Effect.gen(function* () {
      recordedIntegrationEvents.length = 0;
      const fixture = yield* makeFixture();
      yield* stageAndConfirm(
        fixture,
        [
          "title,board",
          "Known board post,Test board",
          "New board post,Bugs",
          "Another new board post,Ideas",
        ].join("\n")
      );

      const outcome = yield* runDataImportPass(yield* claim("worker-1"));
      expect(outcome).toMatchObject({ createdCount: 3, errorCount: 0 });

      const db = yield* currentDb;
      const posts = yield* db
        .select()
        .from(schema.postTable)
        .where(eq(schema.postTable.organizationId, fixture.organizationId));
      const boards = yield* db
        .select()
        .from(schema.boardTable)
        .where(eq(schema.boardTable.organizationId, fixture.organizationId));
      const boardByName = new Map(
        boards.map((board) => [board.name, board.id])
      );

      expect(posts).toHaveLength(3);
      const byTitle = new Map(posts.map((post) => [post.title, post]));
      expect(byTitle.get("Known board post")?.boardId).toBe(fixture.boardId);
      expect(byTitle.get("New board post")?.boardId).toBe(
        boardByName.get("Bugs")
      );
      expect(byTitle.get("Another new board post")?.boardId).toBe(
        boardByName.get("Ideas")
      );
      const created = boards.find((board) => board.name === "Bugs");
      expect(created).toMatchObject({
        visibility: "PUBLIC",
      });
      expect(created?.slug).toBe("bugs");
    })
  );

  it.effect("recreates a board deleted after the import was staged", () =>
    Effect.gen(function* () {
      recordedIntegrationEvents.length = 0;
      const fixture = yield* makeFixture();
      yield* stageAndConfirm(fixture, "title,board\nAfter delete,Test board\n");

      const db = yield* currentDb;
      yield* db
        .delete(schema.boardTable)
        .where(eq(schema.boardTable.id, fixture.boardId));

      const outcome = yield* runDataImportPass(yield* claim("worker-1"));
      expect(outcome).toMatchObject({ createdCount: 1, errorCount: 0 });

      const boards = yield* db
        .select()
        .from(schema.boardTable)
        .where(eq(schema.boardTable.organizationId, fixture.organizationId));
      const recreated = boards.find((board) => board.name === "Test board");
      expect(recreated).toBeDefined();
      expect(recreated?.id).not.toBe(fixture.boardId);

      const posts = yield* db
        .select()
        .from(schema.postTable)
        .where(eq(schema.postTable.organizationId, fixture.organizationId));
      expect(posts).toHaveLength(1);
      expect(posts[0]?.boardId).toBe(recreated?.id);
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

  it.effect("stops without finalizing once another worker owns the lease", () =>
    Effect.gen(function* () {
      recordedIntegrationEvents.length = 0;
      const fixture = yield* makeFixture();
      const job = yield* stageAndConfirm(fixture, "title\nLease test\n");
      const claimed = yield* claim("worker-1");
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;
      // Hand the job to a second worker without going through claim: the
      // first worker's renewal must fail and it must write nothing.
      yield* db
        .update(schema.dataImportJobTable)
        .set({
          leaseExpiresAt: DateTime.fromDateUnsafe(now).pipe(
            DateTime.addDuration(Duration.minutes(5)),
            DateTime.toDate
          ),
          leaseOwner: "worker-2",
        })
        .where(eq(schema.dataImportJobTable.id, job.id));

      const outcome = yield* runDataImportPass(claimed);
      expect(outcome.createdCount).toBe(0);

      const repository = yield* DataTransferRepository;
      const stored = yield* repository.findJob({
        id: job.id,
        organizationId: fixture.organizationId,
      });
      expect(Option.isSome(stored)).toBe(true);
      if (Option.isSome(stored)) {
        expect(stored.value.status).toBe("running");
      }

      const posts = yield* db
        .select()
        .from(schema.postTable)
        .where(eq(schema.postTable.organizationId, fixture.organizationId));
      expect(posts).toEqual([]);
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

  it.effect("a canceled job cannot mark a pending row created", () =>
    Effect.gen(function* () {
      recordedIntegrationEvents.length = 0;
      const fixture = yield* makeFixture();
      // A real post for the second job's row to point at, so the assertion
      // isolates the job-status guard from the row's foreign key.
      yield* stageAndConfirm(fixture, "title\nFirst post\n");
      yield* runDataImportPass(yield* claim("worker-1"));

      const db = yield* currentDb;
      const [post] = yield* db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(eq(schema.postTable.organizationId, fixture.organizationId));
      if (post === undefined) {
        throw new Error("Expected the first import to create a post.");
      }

      const canceledJob = yield* stageAndConfirm(
        fixture,
        "title\nSecond post\n"
      );
      const repository = yield* DataTransferRepository;
      yield* repository.cancelJob({
        id: canceledJob.id,
        organizationId: fixture.organizationId,
      });

      const rows = yield* db
        .select({ id: schema.dataImportRowTable.id })
        .from(schema.dataImportRowTable)
        .where(eq(schema.dataImportRowTable.jobId, canceledJob.id));
      const rowId = rows[0]?.id;
      if (rowId === undefined) {
        throw new Error("Expected the second job's staged row to exist.");
      }

      // The cancel happened after the worker claimed the job, so the row
      // guard alone would let this update through; the job-status condition
      // is what rolls the post transaction back.
      const error = yield* Effect.flip(
        repository.markRowCreated({
          jobId: canceledJob.id,
          postId: post.id,
          rowId,
        })
      );
      expect(error._tag).toBe("DataTransferRepositoryError");

      const [stored] = yield* db
        .select({ outcome: schema.dataImportRowTable.outcome })
        .from(schema.dataImportRowTable)
        .where(eq(schema.dataImportRowTable.id, rowId));
      expect(stored?.outcome).toBe("pending");
    })
  );

  it.effect("a late row failure cannot overwrite a row already created", () =>
    Effect.gen(function* () {
      recordedIntegrationEvents.length = 0;
      const fixture = yield* makeFixture();
      const job = yield* stageAndConfirm(fixture, "title\nApplied once\n");
      const claimed = yield* claim("worker-1");
      yield* runDataImportPass(claimed);

      const repository = yield* DataTransferRepository;
      const db = yield* currentDb;
      const rows = yield* db
        .select({
          id: schema.dataImportRowTable.id,
          outcome: schema.dataImportRowTable.outcome,
        })
        .from(schema.dataImportRowTable)
        .where(eq(schema.dataImportRowTable.jobId, job.id));
      const row = rows[0];
      if (row === undefined) {
        throw new Error("Expected the staged row to exist.");
      }
      expect(row.outcome).toBe("created");

      // The row is no longer pending, so a pass that lost its lease cannot
      // flip it back to failed while the post it created still exists.
      yield* repository.markRowFailed({
        message: "A pass that lost its lease",
        rowId: row.id,
      });

      const [stored] = yield* db
        .select({
          message: schema.dataImportRowTable.message,
          outcome: schema.dataImportRowTable.outcome,
        })
        .from(schema.dataImportRowTable)
        .where(eq(schema.dataImportRowTable.id, row.id));
      expect(stored?.outcome).toBe("created");
      expect(stored?.message).toBeNull();
    })
  );

  it.effect(
    "a canceled job keeps its lease owner so the final counts land",
    () =>
      Effect.gen(function* () {
        recordedIntegrationEvents.length = 0;
        const fixture = yield* makeFixture();
        const job = yield* stageAndConfirm(fixture, "title\nNever applied\n");
        yield* claim("worker-1");

        const repository = yield* DataTransferRepository;
        const db = yield* currentDb;
        const rows = yield* db
          .select({ id: schema.dataImportRowTable.id })
          .from(schema.dataImportRowTable)
          .where(eq(schema.dataImportRowTable.jobId, job.id));
        const rowId = rows[0]?.id;
        if (rowId === undefined) {
          throw new Error("Expected the staged row to exist.");
        }
        yield* repository.markRowFailed({ message: "Never applied.", rowId });

        yield* repository.cancelJob({
          id: job.id,
          organizationId: fixture.organizationId,
        });
        // The canceled pass's last sync is what records the outcomes the
        // ledger already holds; it only lands while the owner still matches.
        yield* repository.syncCounts({ jobId: job.id, leaseOwner: "worker-1" });

        const stored = yield* repository.findJob({
          id: job.id,
          organizationId: fixture.organizationId,
        });
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.status).toBe("canceled");
          expect(stored.value.errorCount).toBe(1);
        }
      })
  );
});
