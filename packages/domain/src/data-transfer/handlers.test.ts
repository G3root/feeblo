import { NodeCrypto } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  DataImportJobId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuditLogEnabled } from "../audit-log/flag";
import { AuditLogRecorder } from "../audit-log/recorder";
import { BoardRepository } from "../board/repository";
import { PostStatusRepository } from "../post-status/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { DataTransferRpcHandlersEffect } from "./handlers";
import { DataImportService } from "./import-service";
import { DataTransferRepository } from "./repository";

type Fixture = {
  boardId: string;
  membershipId: string;
  organizationId: string;
  statusId: string;
  userEmail: string;
  userId: string;
};

const encoder = new TextEncoder();

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
    } satisfies Fixture;
  });

const makeSession = (fixture: Fixture): Session => ({
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

const TestLayer = Layer.mergeAll(
  DataImportService.layer,
  DataTransferRepository.layer,
  BoardRepository.layer,
  PostStatusRepository.layer,
  AuditLogRecorder.layer.pipe(Layer.provide(Database.PgliteDatabaseLive))
).pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive),
  Layer.provideMerge(NodeCrypto.layer)
);

layer(TestLayer)("DataTransferRpcHandlers", (it) => {
  it.effect(
    "records a confirmed import against the person who released it",
    () =>
      Effect.gen(function* () {
        const handlers = yield* DataTransferRpcHandlersEffect;
        const service = yield* DataImportService;
        const fixture = yield* makeFixture();

        const session = Effect.provideService(
          CurrentSession,
          makeSession(fixture)
        );

        const job = yield* service
          .stageBoardImport({
            bytes: encoder.encode("title\nFirst\n"),
            fileName: "posts.csv",
            memberId: fixture.membershipId,
            organizationId: fixture.organizationId,
            userId: fixture.userId,
          })
          .pipe(session);

        yield* handlers
          .ConfirmDataImport({
            id: yield* DataImportJobId.parse(job.id),
            organizationId: fixture.organizationId,
          })
          .pipe(session, Effect.provideService(AuditLogEnabled, true));

        const db = yield* currentDb;

        const rows = yield* db
          .select()
          .from(schema.auditLogTable)
          .where(
            and(
              eq(schema.auditLogTable.organizationId, fixture.organizationId),
              eq(schema.auditLogTable.action, "data_transfer.imported")
            )
          );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          action: "data_transfer.imported",
          actorType: "user",
          actorUserId: fixture.userId,
          metadata: { jobId: job.id },
          outcome: "allowed",
          resourceType: "data_transfer",
          source: "dashboard",
        });
      })
  );
});
