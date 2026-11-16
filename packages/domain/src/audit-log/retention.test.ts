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

  /** Named, because the id and the organization are both strings. */
  interface TSeedRow {
    readonly organizationId: string;
    readonly occurredAt: Date;
    readonly id: string;
  }

  const rowAt = ({
    organizationId,
    occurredAt,
    id,
  }: TSeedRow): TAuditLogInsert => ({
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
  });

  const appendAt = (args: Omit<TSeedRow, "id">) =>
    Effect.gen(function* () {
      const repository = yield* AuditLogRepository;
      const id = yield* AuditLogId.generate;
      yield* repository.insert(rowAt({ ...args, id }));
    });

  /**
   * Seeds `count` entries at one instant.
   *
   * Chunked: one statement per 500 rows keeps the bind-parameter count well
   * inside Postgres' limit, and the retention test only cares about how many
   * rows exist, not how they got there.
   */
  const appendManyAt = (
    args: Omit<TSeedRow, "id"> & { readonly count: number }
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      const ids = yield* Effect.forEach(
        Array.from({ length: args.count }, (_, index) => index),
        () => AuditLogId.generate
      );

      for (let index = 0; index < ids.length; index += 500) {
        yield* db
          .insert(schema.auditLogTable)
          .values(
            ids.slice(index, index + 500).map((id) => rowAt({ ...args, id }))
          );
      }
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

        yield* appendAt({
          organizationId,
          occurredAt: days(AUDIT_LOG_RETENTION_DAYS + 40),
        });
        yield* appendAt({
          organizationId,
          occurredAt: days(AUDIT_LOG_RETENTION_DAYS - 1),
        });
        yield* appendAt({ organizationId, occurredAt: days(1) });

        const removed = yield* runAuditLogRetentionPass();
        expect(removed).toBe(1);
        expect(yield* countFor(organizationId)).toBe(2);
      })
    );

    it.effect("drains more than one batch in a single pass", () =>
      Effect.gen(function* () {
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.now;

        const stale = DateTime.toDate(
          DateTime.subtract({ days: AUDIT_LOG_RETENTION_DAYS + 40 })(now)
        );

        const fresh = DateTime.toDate(DateTime.subtract({ days: 2 })(now));

        // One row past the batch limit: a pass that stops after its first
        // statement would leave exactly one expired entry behind, and the
        // count below would catch it.
        const expired = 5_001;
        yield* appendManyAt({
          organizationId,
          occurredAt: stale,
          count: expired,
        });
        yield* appendAt({ organizationId, occurredAt: fresh });

        const removed = yield* runAuditLogRetentionPass();
        expect(removed).toBe(expired);
        expect(yield* countFor(organizationId)).toBe(1);
      })
    );
  });
});
