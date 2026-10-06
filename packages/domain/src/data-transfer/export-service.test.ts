import { NodeCrypto } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  ContactId,
  PostId,
  PostStatusId,
  TagId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { BoardRepository } from "../board/repository";
import { PublicApiConfig } from "../public-api/config";
import { CurrentSession, type Session } from "../session-middleware";
import { streamBoardPostCsv } from "./export-service";
import { DATA_EXPORT_MAX_ROWS } from "./limits";
import { DataTransferRepository } from "./repository";

const textDecoder = new TextDecoder();

/** A `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: string): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

const makeFixture = (
  role: Session["memberships"][number]["role"] = "manager"
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const boardId = yield* BoardId.generate;
    const statusId = yield* PostStatusId.generate;
    const closedStatusId = yield* PostStatusId.generate;
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
      name: "Feedback",
      slug: "feedback",
      visibility: "PUBLIC",
      organizationId,
      creatorId: userId,
      creatorMemberId: membershipId,
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.postStatusTable).values([
      {
        id: statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId,
      },
      {
        id: closedStatusId,
        label: "Won't do",
        type: "CLOSED",
        orderIndex: 1,
        organizationId,
      },
    ]);

    return {
      boardId,
      closedStatusId,
      membershipId,
      organizationId,
      statusId,
      userId,
    };
  });

const makeSession = (
  fixture: Effect.Success<ReturnType<typeof makeFixture>>
): Session => ({
  user: {
    id: fixture.userId,
    email: `${fixture.organizationId}@example.com`,
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

const TestLayer = Layer.mergeAll(
  DataTransferRepository.layer,
  BoardRepository.layer
).pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive),
  Layer.provideMerge(NodeCrypto.layer),
  Layer.provideMerge(PublicApiConfig.layerTest(new URL("https://app.test")))
);

const exportBoard = (
  fixture: Effect.Success<ReturnType<typeof makeFixture>>,
  includeArchived = false
) =>
  Effect.gen(function* () {
    const exportFile = yield* streamBoardPostCsv({
      boardId: fixture.boardId,
      includeArchived,
      organizationId: fixture.organizationId,
    });
    const chunks = yield* Stream.runCollect(exportFile.stream);
    return {
      csv: chunks.map((chunk) => textDecoder.decode(chunk)).join(""),
      fileName: exportFile.fileName,
    };
  }).pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

layer(TestLayer)("streamBoardPostCsv", (it) => {
  it.effect("streams a board's posts with status, author, tags and votes", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const db = yield* currentDb;
      const contactId = yield* ContactId.generate;
      const tagId = yield* TagId.generate;
      const postId = yield* PostId.generate;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.contactTable).values({
        id: contactId,
        email: "jane@example.com",
        name: "Jane",
        organizationId: fixture.organizationId,
        source: "DASHBOARD",
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.tagTable).values({
        id: tagId,
        name: "Bug",
        slug: "bug",
        organizationId: fixture.organizationId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postTable).values({
        id: postId,
        title: "Commas, quotes",
        slug: "commas-quotes",
        content: "A body",
        boardId: fixture.boardId,
        statusId: fixture.statusId,
        organizationId: fixture.organizationId,
        contactId,
        source: "IMPORT",
        createdAt: dateAt("2026-01-02T03:04:05.000Z"),
        updatedAt: dateAt("2026-01-03T03:04:05.000Z"),
      });
      yield* db.insert(schema.postTagTable).values({
        id: `ptg_${postId}`,
        postId,
        tagId,
        organizationId: fixture.organizationId,
      });
      yield* db.insert(schema.upvoteTable).values({
        id: `upv_${postId}`,
        postId,
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        createdAt: now,
      });

      const result = yield* exportBoard(fixture);

      expect(result.fileName).toMatch(
        /^feedback-posts-\d{4}-\d{2}-\d{2}\.csv$/u
      );
      const lines = result.csv
        .replace(/^\uFEFF/u, "")
        .trimEnd()
        .split("\r\n");
      expect(lines[0]).toBe(
        "title,content,status,board,tags,eta,author_name,author_email,vote_count,created_at,updated_at,url"
      );
      expect(lines[1]).toContain('"Commas, quotes"');
      expect(lines[1]).toContain("Pending");
      expect(lines[1]).toContain("Feedback");
      expect(lines[1]).toContain("Bug");
      expect(lines[1]).toContain("Jane");
      expect(lines[1]).toContain("jane@example.com");
      expect(lines[1]).toContain("1");
      expect(lines[1]).toContain("2026-01-02T03:04:05.000Z");
      expect(lines[1]).toContain(
        "https://app.test/" +
          encodeURIComponent(fixture.organizationId) +
          "/post/feedback/commas-quotes"
      );
    })
  );

  it.effect("uses the custom status label as the display name", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.postTable).values({
        id: yield* PostId.generate,
        title: "Closed post",
        slug: "closed-post",
        content: "Body",
        boardId: fixture.boardId,
        statusId: fixture.closedStatusId,
        organizationId: fixture.organizationId,
        createdAt: now,
        updatedAt: now,
      });

      const result = yield* exportBoard(fixture);

      expect(result.csv).toContain("Won't do");
    })
  );

  it.effect("omits archived posts unless asked for them", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.postTable).values([
        {
          id: yield* PostId.generate,
          title: "Live post",
          slug: "live-post",
          content: "Body",
          boardId: fixture.boardId,
          statusId: fixture.statusId,
          organizationId: fixture.organizationId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: yield* PostId.generate,
          title: "Archived post",
          slug: "archived-post",
          content: "Body",
          boardId: fixture.boardId,
          statusId: fixture.statusId,
          organizationId: fixture.organizationId,
          archivedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const withoutArchived = yield* exportBoard(fixture, false);
      expect(withoutArchived.csv).toContain("Live post");
      expect(withoutArchived.csv).not.toContain("Archived post");

      const withArchived = yield* exportBoard(fixture, true);
      expect(withArchived.csv).toContain("Archived post");
    })
  );

  it.effect("refuses an export past the row cap before streaming", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;
      const rows = Array.from(
        { length: DATA_EXPORT_MAX_ROWS + 1 },
        (_, index) => ({
          id: `pst_bulk_${index}`,
          title: `Bulk post ${index}`,
          slug: `bulk-post-${index}`,
          content: "Body",
          boardId: fixture.boardId,
          statusId: fixture.statusId,
          organizationId: fixture.organizationId,
          createdAt: now,
          updatedAt: now,
        })
      );
      const chunkSize = 2000;
      for (let offset = 0; offset < rows.length; offset += chunkSize) {
        yield* db
          .insert(schema.postTable)
          .values(rows.slice(offset, offset + chunkSize));
      }

      const error = yield* Effect.flip(exportBoard(fixture));

      expect(error._tag).toBe("DataExportTooLargeError");

      const count = yield* db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(eq(schema.postTable.organizationId, fixture.organizationId));
      expect(count.length).toBe(DATA_EXPORT_MAX_ROWS + 1);
    })
  );
});
