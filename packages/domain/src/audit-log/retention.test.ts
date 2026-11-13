import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { AuditLogId, WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuditLogRepository, type TAuditLogInsert } from "./repository";
import {
  AUDIT_LOG_RETENTION_DAYS,
  runAuditLogRetentionPass,
} from "./retention";

describe("audit log retention", () => {
  const TestLayer = AuditLogRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = Effect.fnUntraced(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Audit workspace",
      slug: organizationId,
      createdAt: now,
    });
    return organizationId;
  });

  const appendAt = (organizationId: string, occurredAt: Date) =>
    Effect.gen(function* () {
      const repository = yield* AuditLogRepository;
      const id = yield* AuditLogId.generate;
      const row: TAuditLogInsert = {
        action: "workspace.updated",
        actorLabel: null,
        actorRole: "admin",
        actorTokenId: null,
        actorType: "user",
        actorUserId: "user_1",
        affectedUserId: null,
        changes: null,
        denialReason: null,
        id,
        metadata: null,
        occurredAt,
        organizationId,
        originCountry: null,
        originIp: null,
        outcome: "allowed",
        requestId: null,
        resourceId: null,
        resourceType: "workspace",
        source: "dashboard",
        userAgent: null,
      };
      yield* repository.insert(row);
    });

  const countFor = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const rows = yield* db.select().from(schema.auditLogTable);
      return rows.filter((row) => row.organizationId === organizationId).length;
    });

  layer(TestLayer)("retention", (it) => {
    it.effect("removes entries past the window and keeps the rest", () =>
      Effect.gen(function* () {
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.now;
        const days = (value: number) =>
          DateTime.toDate(DateTime.subtract({ days: value })(now));

        yield* appendAt(organizationId, days(AUDIT_LOG_RETENTION_DAYS + 40));
        yield* appendAt(organizationId, days(AUDIT_LOG_RETENTION_DAYS - 1));
        yield* appendAt(organizationId, days(1));

        const removed = yield* runAuditLogRetentionPass();
        expect(removed).toBe(1);
        expect(yield* countFor(organizationId)).toBe(2);
      })
    );

    it.effect("sweeps in batches and keeps the newest of every batch", () =>
      Effect.gen(function* () {
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.now;
        const stale = DateTime.toDate(
          DateTime.subtract({ days: AUDIT_LOG_RETENTION_DAYS + 40 })(now)
        );
        const fresh = DateTime.toDate(DateTime.subtract({ days: 2 })(now));

        // Three stale and one fresh is enough to prove the loop drains more
        // than a single statement would.
        yield* Effect.forEach([0, 1, 2], () => appendAt(organizationId, stale));
        yield* appendAt(organizationId, fresh);

        yield* runAuditLogRetentionPass();
        expect(yield* countFor(organizationId)).toBe(1);
      })
    );
  });
});
