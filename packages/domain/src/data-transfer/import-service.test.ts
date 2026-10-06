import { NodeCrypto } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import type { LegidOf } from "@feeblo/id";
import { BoardId, PostStatusId, WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BoardRepository } from "../board/repository";
import { PostStatusRepository } from "../post-status/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { DataImportService } from "./import-service";
import { DataTransferRepository } from "./repository";

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
        boardId: fixture.boardId,
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

const TestLayer = Layer.mergeAll(
  DataImportService.layer,
  DataTransferRepository.layer,
  BoardRepository.layer,
  PostStatusRepository.layer
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
        'The file names a different board; all rows import into "Test board".',
      ]);

      const repository = yield* DataTransferRepository;
      const report = yield* repository.listRows({
        jobId: job.id,
        limit: 10,
        offset: 0,
      });
      expect(report.total).toBe(3);
      expect(report.rows).toEqual([
        expect.objectContaining({ outcome: "pending", rowNumber: 2 }),
        expect.objectContaining({ outcome: "pending", rowNumber: 3 }),
        expect.objectContaining({
          message: "The title is required.",
          outcome: "failed",
          rowNumber: 4,
        }),
      ]);
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

  it.effect("warns when the same file has been imported before", () =>
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
      expect(again.notices).toEqual([
        expect.stringMatching(
          /^This file was already imported on \d{4}-\d{2}-\d{2}\.$/u
        ),
      ]);
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

  it.effect("refuses a board that is not in the workspace", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const other = yield* makeFixture();
      const service = yield* DataImportService;
      const error = yield* Effect.flip(
        service
          .stageBoardImport({
            boardId: other.boardId,
            bytes: encoder.encode("title\nFirst\n"),
            fileName: "posts.csv",
            memberId: fixture.membershipId,
            organizationId: fixture.organizationId,
            userId: fixture.userId,
          })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession(fixture, "manager")
            )
          )
      );

      expect(error._tag).toBe("DataTransferBoardNotFoundError");
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
});
