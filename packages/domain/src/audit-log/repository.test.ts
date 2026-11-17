import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema, transaction } from "@feeblo/db";
import { AuditLogId, WorkspaceId } from "@feeblo/id";
import { eq, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuditLogRepository, type TAuditLogInsert } from "./repository";
import type { TAuditLogCursor, TAuditLogStoredEntry } from "./schema";

const T0 = new Date("2026-01-01T00:00:00.000Z");

const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe("AuditLogRepository", () => {
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

  const baseRow = (
    organizationId: string,
    occurredAt: Date
  ): Omit<TAuditLogInsert, "id"> => ({
    organizationId,
    occurredAt,
    actorType: "user",
    actorUserId: "user_1",
    actorTokenId: null,
    actorLabel: null,
    actorRole: "admin",
    affectedUserId: null,
    source: "dashboard",
    action: "post.updated",
    outcome: "allowed",
    denialReason: null,
    resourceType: "post",
    resourceId: "post_1",
    changes: null,
    metadata: null,
    requestId: null,
    originIp: null,
    originCountry: null,
    userAgent: null,
  });

  const append = (
    organizationId: string,
    overrides: Partial<TAuditLogInsert> = {}
  ) =>
    Effect.gen(function* () {
      const repository = yield* AuditLogRepository;
      const id = yield* AuditLogId.generate;
      yield* repository.insert({
        ...baseRow(organizationId, T0),
        ...overrides,
        id,
      });

      return id;
    });

  layer(TestLayer)("repository", (it) => {
    it.effect("lists newest first and pages on the sort key", () =>
      Effect.gen(function* () {
        const repository = yield* AuditLogRepository;
        const organizationId = yield* createOrganization();
        const oldest = yield* append(organizationId, { occurredAt: at(0) });
        const middle = yield* append(organizationId, { occurredAt: at(1) });
        const newest = yield* append(organizationId, { occurredAt: at(2) });

        const first = yield* repository.findPage({ limit: 2, organizationId });
        expect(first.items.map((entry) => entry.id)).toEqual([newest, middle]);
        expect(first.next).not.toBeNull();

        const second = yield* repository.findPage(
          first.next === null
            ? { limit: 2, organizationId }
            : { limit: 2, organizationId, after: first.next }
        );

        expect(second.items.map((entry) => entry.id)).toEqual([oldest]);
        expect(second.next).toBeNull();
      })
    );

    it.effect("keeps paging stable when entries share a timestamp", () =>
      Effect.gen(function* () {
        const repository = yield* AuditLogRepository;
        const organizationId = yield* createOrganization();

        const ids = yield* Effect.forEach([0, 1, 2], () =>
          append(organizationId, { occurredAt: at(5) })
        );

        const seen: string[] = [];
        let after: TAuditLogCursor | null = null;

        for (let page = 0; page < 4; page += 1) {
          const result: {
            readonly items: ReadonlyArray<TAuditLogStoredEntry>;
            readonly next: TAuditLogCursor | null;
          } = yield* repository.findPage(
            after === null
              ? { limit: 2, organizationId }
              : { limit: 2, organizationId, after }
          );

          seen.push(...result.items.map((entry) => entry.id));
          after = result.next;

          if (after === null) break;
        }

        expect(seen).toHaveLength(ids.length);
        expect(new Set(seen).size).toBe(ids.length);
      })
    );

    it.effect("splits changes from data access and keeps a denied read", () =>
      Effect.gen(function* () {
        const repository = yield* AuditLogRepository;
        const organizationId = yield* createOrganization();
        const change = yield* append(organizationId);

        const exportAllowed = yield* append(organizationId, {
          action: "board.exported",
          resourceType: "board",
          resourceId: "board_1",
          occurredAt: at(1),
        });

        const exportDenied = yield* append(organizationId, {
          action: "board.exported",
          resourceType: "board",
          resourceId: "board_1",
          outcome: "denied",
          denialReason: "Missing boards.exportData",
          occurredAt: at(2),
        });

        const changes = yield* repository.findPage({
          kind: "changes",
          limit: 10,
          organizationId,
        });

        expect(changes.items.map((entry) => entry.id).sort()).toEqual(
          [change, exportDenied].sort()
        );

        const access = yield* repository.findPage({
          kind: "access",
          limit: 10,
          organizationId,
        });

        expect(access.items.map((entry) => entry.id).sort()).toEqual(
          [exportAllowed, exportDenied].sort()
        );
      })
    );

    it.effect("filters by the field an update touched", () =>
      Effect.gen(function* () {
        const repository = yield* AuditLogRepository;
        const organizationId = yield* createOrganization();

        const status = yield* append(organizationId, {
          action: "post.status_changed",
          changes: {
            fields: ["statusId"],
            before: { statusId: "status_1" },
            after: { statusId: "status_2" },
          },
        });

        yield* append(organizationId, {
          action: "post.updated",
          changes: {
            fields: ["title"],
            before: { title: "Before" },
            after: { title: "After" },
          },
          occurredAt: at(1),
        });

        const found = yield* repository.findPage({
          changedField: "statusId",
          limit: 10,
          organizationId,
        });

        expect(found.items.map((entry) => entry.id)).toEqual([status]);
      })
    );

    it.effect("does not list another workspace's entries", () =>
      Effect.gen(function* () {
        const repository = yield* AuditLogRepository;
        const mine = yield* createOrganization();
        const theirs = yield* createOrganization();
        yield* append(mine);
        const foreign = yield* append(theirs);

        const page = yield* repository.findPage({
          limit: 10,
          organizationId: mine,
        });

        expect(page.items.map((entry) => entry.id)).not.toContain(foreign);
      })
    );

    it.effect("keeps entries when the workspace is deleted", () =>
      Effect.gen(function* () {
        const repository = yield* AuditLogRepository;
        const db = yield* currentDb;
        const organizationId = yield* createOrganization();
        const id = yield* append(organizationId);

        // No foreign key on `organization_id`, deliberately: a cascade would
        // delete the entries, and the append-only trigger refuses exactly that
        // delete. Workspace deletion happens in the auth layer, inside
        // better-auth's transaction, so the audit module cannot join it to set
        // the retention GUC. An entry outlives its workspace instead, and the
        // retention sweep is what eventually removes it.
        yield* db
          .delete(schema.organizationTable)
          .where(eq(schema.organizationTable.id, organizationId));

        const page = yield* repository.findPage({ limit: 10, organizationId });
        expect(page.items.map((entry) => entry.id)).toEqual([id]);
      })
    );

    it.effect("rejects a resource type that disagrees with the action", () =>
      Effect.gen(function* () {
        const repository = yield* AuditLogRepository;
        const organizationId = yield* createOrganization();
        const id = yield* AuditLogId.generate;

        const failure = yield* Effect.flip(
          repository.insert({
            ...baseRow(organizationId, T0),
            // A writer that bypassed `record` cannot store a pair the reader
            // would filter on inconsistently.
            resourceType: "workspace",
            id,
          })
        );

        expect(failure._tag).toBe("EffectDrizzleQueryError");
      })
    );

    it.effect("is append-only unless retention says otherwise", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* AuditLogRepository;
        const organizationId = yield* createOrganization();
        const id = yield* append(organizationId);

        const updated = yield* Effect.flip(
          db.execute(
            sql`update audit_log set actor_label = 'rewritten' where id = ${id}`
          )
        );

        expect(updated._tag).toBe("EffectDrizzleQueryError");

        const deleted = yield* Effect.flip(
          db.execute(sql`delete from audit_log where id = ${id}`)
        );

        expect(deleted._tag).toBe("EffectDrizzleQueryError");

        // The retention sweep is the one writer allowed to remove rows, and it
        // says so on its own transaction.
        yield* transaction(
          Effect.gen(function* () {
            const tx = yield* currentDb;
            yield* tx.execute(sql`set local feeblo.audit_retention = 'on'`);
            yield* tx.execute(sql`delete from audit_log where id = ${id}`);
          })
        );

        const page = yield* repository.findPage({ limit: 10, organizationId });
        expect(page.items).toHaveLength(0);
      })
    );
  });
});
