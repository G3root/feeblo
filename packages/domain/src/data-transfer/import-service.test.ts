import { NodeCrypto } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import type { LegidOf } from "@feeblo/id";
import {
  BoardId,
  DataImportJobId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { BoardRepository } from "../board/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { PostStatusRepository } from "../post-status/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { streamImportProblemsCsv } from "./import-problems-csv";
import { DataImportService, type DataImportJobDetail } from "./import-service";
import { DATA_IMPORT_WATCH_MS } from "./limits";
import {
  DataTransferRepository,
  type DataImportJobRecord,
  type NewStagedImportRow,
} from "./repository";

type Role = Session["memberships"][number]["role"];

type Fixture = {
  boardId: LegidOf<"BoardId">;
  membershipId: string;
  organizationId: LegidOf<"WorkspaceId">;
  statusId: LegidOf<"PostStatusId">;
  userEmail: string;
  userId: string;
};

const encoder = new TextEncoder();
const textDecoder = new TextDecoder();

const makeFixture = (role: Role = "manager") =>
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
      role,
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
    } satisfies Fixture;
  });

const makeSession = (fixture: Fixture, role: Role | null): Session => ({
  user: {
    id: fixture.userId,
    email: fixture.userEmail,
    name: "Staff Actor",
    restrictedToOrganizationId: null,
  },
  session: { userId: fixture.userId, token: "test-token" },
  organizations: [{ id: fixture.organizationId }],
  memberships: role
    ? [
        {
          membershipId: fixture.membershipId,
          organizationId: fixture.organizationId,
          role,
        },
      ]
    : [],
});

const stage = (
  fixture: Fixture,
  bytes: Uint8Array,
  options: { readonly fileName?: string; readonly role?: Role | null } = {}
) =>
  Effect.gen(function* () {
    const service = yield* DataImportService;
    return yield* service
      .stageBoardImport({
        bytes,
        fileName: options.fileName ?? "posts.csv",
        memberId: fixture.membershipId,
        organizationId: fixture.organizationId,
        userId: fixture.userId,
      })
      .pipe(
        Effect.provideService(
          CurrentSession,
          makeSession(fixture, options.role ?? "manager")
        )
      );
  });

const WorkspaceLayer = WorkspaceRepository.layer.pipe(
  Layer.provide(Database.PgliteDatabaseLive)
);
const EntitlementTest = EntitlementPolicy.layer.pipe(
  Layer.provide(WorkspaceLayer)
);

const TestLayer = Layer.mergeAll(
  DataImportService.layer.pipe(Layer.provideMerge(EntitlementTest)),
  DataTransferRepository.layer,
  BoardRepository.layer,
  PostStatusRepository.layer,
  EntitlementTest,
  WorkspaceLayer
).pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive),
  Layer.provideMerge(NodeCrypto.layer)
);

layer(TestLayer)("DataImportService", (it) => {
  it.effect("stages a file, keeping failed rows and warnings", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const job = yield* stage(
        fixture,
        encoder.encode(
          [
            "title,content,status,board,tags,eta,author_name,author_email,created_at",
            "Good post,Body,Pending,Another board,Bug;Feature,2026-Q1,Jane,jane@example.com,2026-01-02T03:04:05Z",
            "Warned post,Body,Wontfix,,,not-a-quarter,,,",
            ",No title,X,,,not-a-quarter,,,",
          ].join("\n")
        )
      );

      expect(job).toMatchObject({
        createdCount: 0,
        errorCount: 1,
        rowCount: 3,
        status: "awaiting_confirmation",
        warningCount: 1,
      });
      expect(job.notices).toEqual([
        'The file names a board that does not exist yet; it will be created: "Another board".',
      ]);

      const repository = yield* DataTransferRepository;
      const report = yield* repository.listRows({
        jobId: job.id,
        limit: 10,
        offset: 0,
      });
      expect(report.total).toBe(3);
      expect(report.rows[0]).toMatchObject({
        boardName: "Another board",
        contentPreview: "Body",
        outcome: "pending",
        rowNumber: 2,
        statusName: "Pending",
        title: "Good post",
      });
      // The staged payload's body is never returned whole.
      expect(report.rows[0]).not.toHaveProperty("payload");
      expect(report.rows[1]).toMatchObject({
        boardName: "Test board",
        outcome: "pending",
        rowNumber: 3,
      });
      expect(report.rows[2]).toMatchObject({
        boardName: null,
        contentPreview: null,
        message: "The title is required.",
        outcome: "failed",
        rowNumber: 4,
        statusName: null,
        title: null,
      });
    })
  );

  it.effect("summarizes a report by outcome, warning and board", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const job = yield* stage(
        fixture,
        encoder.encode(
          [
            "title,content,status,board,tags,eta,author_name,author_email,created_at",
            "Good post,Body,Pending,Another board,Bug;Feature,2026-Q1,Jane,jane@example.com,2026-01-02T03:04:05Z",
            "Warned post,Body,Wontfix,,,not-a-quarter,,,",
            ",No title,X,,,not-a-quarter,,,",
          ].join("\n")
        )
      );
      const service = yield* DataImportService;
      const session = Effect.provideService(
        CurrentSession,
        makeSession(fixture, "manager")
      );
      const describe = (input: {
        readonly board?: string;
        readonly filter?: "failed" | "warned" | "pending" | "created";
        readonly message?: string;
        readonly sort?: "row_asc" | "row_desc";
      }) =>
        service
          .describeImport({
            id: job.id,
            organizationId: fixture.organizationId,
            ...input,
          })
          .pipe(session);

      const detail = yield* describe({});

      expect(detail.report.counts).toEqual({
        created: 0,
        failed: 1,
        pending: 2,
        total: 3,
        warned: 1,
      });
      expect(detail.report.failureGroups).toEqual([
        { count: 1, message: "The title is required." },
      ]);
      expect(detail.report.boardGroups).toEqual([
        { count: 1, name: "Another board" },
        { count: 1, name: "Test board" },
      ]);
      expect(detail.newBoards).toEqual(["Another board"]);
      // A substituted row carries its warnings, a clean one carries none.
      expect(detail.report.rows[0]?.warnings).toEqual([]);
      expect(detail.report.rows[1]?.warnings).toHaveLength(3);
      expect(detail.job.retentionExpiresAt).toBeInstanceOf(Date);

      const failed = yield* describe({ filter: "failed" });
      expect(failed.report.total).toBe(1);
      expect(failed.report.rows[0]?.rowNumber).toBe(4);
      // The counts stay whole-job while the page is filtered.
      expect(failed.report.counts.total).toBe(3);

      const warned = yield* describe({ filter: "warned" });
      expect(warned.report.total).toBe(1);
      expect(warned.report.rows[0]?.rowNumber).toBe(3);

      const byMessage = yield* describe({
        filter: "failed",
        message: "The title is required.",
      });
      expect(byMessage.report.total).toBe(1);

      const byBoard = yield* describe({ board: "Another board" });
      expect(byBoard.report.total).toBe(1);
      expect(byBoard.report.rows[0]?.rowNumber).toBe(2);

      const newestFirst = yield* describe({ sort: "row_desc" });
      expect(newestFirst.report.rows[0]?.rowNumber).toBe(4);
    })
  );

  it.effect("bounds a substitution message before it leaves the report", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const job = yield* stage(
        fixture,
        encoder.encode(`title,eta\nLong,${"x".repeat(300)}\n`)
      );
      const service = yield* DataImportService;
      const detail = yield* service
        .describeImport({ id: job.id, organizationId: fixture.organizationId })
        .pipe(
          Effect.provideService(CurrentSession, makeSession(fixture, "manager"))
        );

      const long = detail.report.rows[0]?.warnings.find(
        (warning) => warning.length > 240
      );
      expect(long).toHaveLength(241);
      expect(long?.endsWith("…")).toBe(true);
    })
  );

  it.effect("stops naming new boards once a job leaves staging", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const job = yield* stage(
        fixture,
        encoder.encode("title,board\nNew,Another board\n")
      );
      const service = yield* DataImportService;
      const session = Effect.provideService(
        CurrentSession,
        makeSession(fixture, "manager")
      );
      const before = yield* service
        .describeImport({ id: job.id, organizationId: fixture.organizationId })
        .pipe(session);
      expect(before.newBoards).toEqual(["Another board"]);

      yield* service
        .cancelImport({ id: job.id, organizationId: fixture.organizationId })
        .pipe(session);
      const after = yield* service
        .describeImport({ id: job.id, organizationId: fixture.organizationId })
        .pipe(session);
      expect(after.newBoards).toEqual([]);
    })
  );

  it.effect("streams the problem rows as a repair sheet", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const job = yield* stage(
        fixture,
        encoder.encode(
          [
            "title,content,status,board,tags,eta,author_name,author_email,created_at",
            "Good post,Body,Pending,Another board,Bug;Feature,2026-Q1,Jane,jane@example.com,2026-01-02T03:04:05Z",
            "Warned post,Body,Wontfix,,,not-a-quarter,,,",
            ",No title,X,,,not-a-quarter,,,",
          ].join("\n")
        )
      );
      const session = Effect.provideService(
        CurrentSession,
        makeSession(fixture, "manager")
      );
      const report = yield* streamImportProblemsCsv({
        id: job.id,
        organizationId: fixture.organizationId,
      }).pipe(session);
      const chunks = yield* Stream.runCollect(report.stream);
      const csv = chunks.map((chunk) => textDecoder.decode(chunk)).join("");

      expect(report.fileName).toContain("posts-import-problems-");
      // A UTF-8 decoder drops the leading byte-order mark it reports; the
      // header itself is what the assertion can see.
      expect(csv.startsWith("row_number,outcome,title,board")).toBe(true);
      // The failed row and the substituted row are in the file; the clean one
      // is not, because nothing needs repairing there.
      expect(csv).toContain("4,failed,,,,The title is required.,");
      expect(csv).toContain("3,pending,Warned post,Test board,Pending,,");
      expect(csv).toContain("not-a-quarter");
      expect(csv).not.toContain("Good post");

      const error = yield* Effect.flip(
        streamImportProblemsCsv({
          id: "missing-job-id",
          organizationId: fixture.organizationId,
        }).pipe(session)
      );
      expect(error._tag).toBe("DataImportNotFoundError");
    })
  );

  it.effect("bounds the preview excerpt a report row carries", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const fixtureContent = "x".repeat(300);
      const job = yield* stage(
        fixture,
        encoder.encode(`title,content\nLong,${fixtureContent}\n`)
      );
      const repository = yield* DataTransferRepository;
      const report = yield* repository.listRows({
        jobId: job.id,
        limit: 10,
        offset: 0,
      });

      expect(report.rows[0]?.contentPreview).toHaveLength(281);
      expect(report.rows[0]?.contentPreview?.endsWith("…")).toBe(true);
    })
  );

  it.effect(
    "refuses a second active job at the index, not just the fast path",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const repository = yield* DataTransferRepository;
        const notices: readonly string[] = [];
        const rows: readonly NewStagedImportRow[] = [];
        const base = {
          createdByMemberId: fixture.membershipId,
          createdByUserId: fixture.userId,
          fileName: "posts.csv",
          notices,
          organizationId: fixture.organizationId,
          rows,
        };

        yield* repository.insertStagedJob({
          ...base,
          fileHash: "first",
          id: yield* DataImportJobId.generate,
        });
        const error = yield* Effect.flip(
          repository.insertStagedJob({
            ...base,
            fileHash: "second",
            id: yield* DataImportJobId.generate,
          })
        );

        expect(error._tag).toBe("DataImportAlreadyActiveError");
      })
  );

  it.effect("refuses a second import while one is active", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      yield* stage(fixture, encoder.encode("title\nFirst\n"));
      const error = yield* Effect.flip(
        stage(fixture, encoder.encode("title\nSecond\n"))
      );

      expect(error._tag).toBe("DataImportAlreadyActiveError");
    })
  );

  it.effect("warns when the same file was already confirmed", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const repository = yield* DataTransferRepository;
      const service = yield* DataImportService;
      const session = Effect.provideService(
        CurrentSession,
        makeSession(fixture, "manager")
      );
      const bytes = encoder.encode("title\nFirst\n");
      const first = yield* stage(fixture, bytes);
      yield* service
        .confirmImport({
          id: first.id,
          organizationId: fixture.organizationId,
        })
        .pipe(session);
      yield* repository.cancelJob({
        id: first.id,
        organizationId: fixture.organizationId,
      });

      const again = yield* stage(fixture, bytes);
      expect(again.notices).toEqual([
        expect.stringMatching(
          /^This file was already imported on \d{4}-\d{2}-\d{2}\.$/u
        ),
      ]);
    })
  );

  it.effect("does not warn about an upload that was never confirmed", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const repository = yield* DataTransferRepository;
      const bytes = encoder.encode("title\nFirst\n");
      const first = yield* stage(fixture, bytes);
      yield* repository.cancelJob({
        id: first.id,
        organizationId: fixture.organizationId,
      });

      const again = yield* stage(fixture, bytes);
      expect(again.notices).toEqual([]);
    })
  );

  it.effect("refuses a file past the row cap before staging anything", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const rows = Array.from({ length: 20_001 }, (_, index) => `Row ${index}`);
      const error = yield* Effect.flip(
        stage(fixture, encoder.encode(`title\n${rows.join("\n")}\n`))
      );

      expect(error._tag).toBe("DataImportRowLimitError");
    })
  );

  it.effect("refuses a contributor without boards.importPosts", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("contributor");
      const error = yield* Effect.flip(
        stage(fixture, encoder.encode("title\nFirst\n"), {
          role: "contributor",
        })
      );

      expect(error._tag).toBe("PolicyDenied");
    })
  );

  it.effect("fails an empty board when the workspace has no boards", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const db = yield* currentDb;
      yield* db
        .delete(schema.boardTable)
        .where(eq(schema.boardTable.id, fixture.boardId));

      const job = yield* stage(
        fixture,
        encoder.encode(
          ["title,board", "Named board,Bugs", "Unnamed board,"].join("\n")
        )
      );

      const repository = yield* DataTransferRepository;
      const report = yield* repository.listRows({
        jobId: job.id,
        limit: 10,
        offset: 0,
      });
      expect(report.rows[0]).toMatchObject({
        boardName: "Bugs",
        outcome: "pending",
      });
      expect(report.rows[1]).toMatchObject({
        message:
          "The board is empty and this workspace has no boards. Name a board in the row.",
        outcome: "failed",
      });
      expect(job.notices).toEqual([
        'The file names a board that does not exist yet; it will be created: "Bugs".',
      ]);
    })
  );

  it.effect("confirm queues a staged job exactly once", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const job = yield* stage(fixture, encoder.encode("title\nFirst\n"));
      const service = yield* DataImportService;
      const session = Effect.provideService(
        CurrentSession,
        makeSession(fixture, "manager")
      );

      yield* service
        .confirmImport({
          id: job.id,
          organizationId: fixture.organizationId,
        })
        .pipe(session);
      const repository = yield* DataTransferRepository;
      const queued = yield* repository.findJob({
        id: job.id,
        organizationId: fixture.organizationId,
      });
      expect(Option.isSome(queued)).toBe(true);
      if (Option.isSome(queued)) {
        expect(queued.value.status).toBe("queued");
      }

      const error = yield* Effect.flip(
        service
          .confirmImport({
            id: job.id,
            organizationId: fixture.organizationId,
          })
          .pipe(session)
      );
      expect(error._tag).toBe("DataImportNotConfirmableError");
    })
  );

  it.effect("cancel is idempotent and describe returns the report page", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const job = yield* stage(fixture, encoder.encode("title\nFirst\n"));
      const service = yield* DataImportService;
      const session = Effect.provideService(
        CurrentSession,
        makeSession(fixture, "manager")
      );

      yield* service
        .cancelImport({
          id: job.id,
          organizationId: fixture.organizationId,
        })
        .pipe(session);
      yield* service
        .cancelImport({
          id: job.id,
          organizationId: fixture.organizationId,
        })
        .pipe(session);

      const detail = yield* service
        .describeImport({
          id: job.id,
          organizationId: fixture.organizationId,
          limit: 1,
          offset: 0,
        })
        .pipe(session);
      expect(detail.job.status).toBe("canceled");
      expect(detail.report.total).toBe(1);
      expect(detail.report.rows).toHaveLength(1);

      const error = yield* Effect.flip(
        service
          .describeImport({
            id: (yield* WorkspaceId.generate).slice(0, 20),
            organizationId: fixture.organizationId,
          })
          .pipe(session)
      );
      expect(error._tag).toBe("DataImportNotFoundError");
    })
  );

  it.effect("lists a workspace's jobs newest first", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      yield* stage(fixture, encoder.encode("title\nFirst\n"));
      const service = yield* DataImportService;
      const jobs = yield* service
        .listImports({ organizationId: fixture.organizationId })
        .pipe(
          Effect.provideService(CurrentSession, makeSession(fixture, "manager"))
        );

      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.fileName).toBe("posts.csv");
    })
  );

  it.effect("watches one job until it reaches a terminal status", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const job = yield* stage(fixture, encoder.encode("title\nFirst\n"));
      const service = yield* DataImportService;
      const session = makeSession(fixture, "manager");
      const emissions = yield* Queue.unbounded<DataImportJobDetail>();

      const watcher = yield* service
        .watchImport({
          id: job.id,
          organizationId: fixture.organizationId,
          limit: 10,
          offset: 0,
        })
        .pipe(
          Stream.tap((detail) => Queue.offer(emissions, detail)),
          Stream.runDrain,
          Effect.provideService(CurrentSession, session),
          Effect.forkChild
        );

      const first = yield* Queue.take(emissions);
      expect(first.job.status).toBe("awaiting_confirmation");

      yield* service
        .cancelImport({ id: job.id, organizationId: fixture.organizationId })
        .pipe(Effect.provideService(CurrentSession, session));
      yield* TestClock.adjust(DATA_IMPORT_WATCH_MS);

      const second = yield* Queue.take(emissions);
      expect(second.job.status).toBe("canceled");

      // The terminal snapshot is the last one: the stream ends on its own.
      yield* Fiber.join(watcher);
      expect(yield* Queue.size(emissions)).toBe(0);
    })
  );

  it.effect(
    "keeps watching the job list and stays silent on unchanged ticks",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const job = yield* stage(fixture, encoder.encode("title\nFirst\n"));
        const service = yield* DataImportService;
        const session = makeSession(fixture, "manager");
        const emissions =
          yield* Queue.unbounded<readonly DataImportJobRecord[]>();

        const watcher = yield* service
          .watchImportList({ organizationId: fixture.organizationId })
          .pipe(
            Stream.tap((jobs) => Queue.offer(emissions, jobs)),
            Stream.runDrain,
            Effect.provideService(CurrentSession, session),
            Effect.forkChild
          );

        const first = yield* Queue.take(emissions);
        expect(first.map((entry) => entry.status)).toEqual([
          "awaiting_confirmation",
        ]);

        // A tick that finds the same rows emits nothing.
        yield* TestClock.adjust(DATA_IMPORT_WATCH_MS);
        expect(Option.isNone(yield* Queue.poll(emissions))).toBe(true);

        // The next real change still gets through, so the watch survived.
        yield* service
          .cancelImport({ id: job.id, organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));
        yield* TestClock.adjust(DATA_IMPORT_WATCH_MS);

        const second = yield* Queue.take(emissions);
        expect(second[0]?.status).toBe("canceled");

        // The list has no terminal state to end on; the caller ends it.
        yield* Fiber.interrupt(watcher);
      })
  );
});
