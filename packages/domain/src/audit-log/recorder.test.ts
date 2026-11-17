import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Session } from "../session-middleware";
import { actorFromSession, actorFromSystem } from "./attribution";
import { AuditLogEnabled } from "./flag";
import { AuditLogRecorder } from "./recorder";
import { AuditLogRepository } from "./repository";

describe("AuditLogRecorder", () => {
  const TestLayer = Layer.mergeAll(
    AuditLogRepository.layer,
    AuditLogRecorder.layer
  ).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

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

  /** The layer is memoized across this block, so every assertion scopes to its own workspace. */
  const rowsFor = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      return yield* db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.organizationId, organizationId));
    });

  const sessionOf = (
    organizationId: string,
    role: "admin" | "manager"
  ): Session => ({
    user: {
      email: "user@example.com",
      id: `user_${organizationId}`,
      name: "Test user",
      restrictedToOrganizationId: null,
    },
    session: { token: "test-token", userId: `user_${organizationId}` },
    organizations: [{ id: organizationId }],
    memberships: [
      {
        membershipId: `member_${organizationId}`,
        organizationId,
        role,
      },
    ],
  });

  layer(TestLayer)("recorder", (it) => {
    it.effect("writes nothing while the flag is off", () =>
      Effect.gen(function* () {
        const recorder = yield* AuditLogRecorder;
        const organizationId = yield* createOrganization();

        yield* recorder.record({
          organizationId,
          actor: actorFromSystem(),
          source: "system",
          action: "workspace.updated",
        });

        expect(yield* rowsFor(organizationId)).toHaveLength(0);
      })
    );

    it.effect("writes one entry, deriving the resource type", () =>
      Effect.gen(function* () {
        const recorder = yield* AuditLogRecorder;
        const organizationId = yield* createOrganization();
        const session = sessionOf(organizationId, "admin");

        yield* recorder
          .record({
            organizationId,
            actor: actorFromSession(session, organizationId),
            source: "dashboard",
            action: "post.updated",
            resourceId: "post_1",
            changes: {
              fields: ["title"],
              before: { title: "Before" },
              after: { title: "After" },
            },
          })
          .pipe(Effect.provideService(AuditLogEnabled, true));

        const rows = yield* rowsFor(organizationId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          action: "post.updated",
          actorRole: "admin",
          actorType: "user",
          actorUserId: session.session.userId,
          organizationId,
          outcome: "allowed",
          resourceId: "post_1",
          resourceType: "post",
          source: "dashboard",
        });
        expect(rows[0]?.occurredAt).toBeInstanceOf(Date);
      })
    );

    it.effect("redacts a credential-shaped field before storing a diff", () =>
      Effect.gen(function* () {
        const recorder = yield* AuditLogRecorder;
        const organizationId = yield* createOrganization();

        yield* recorder
          .record({
            organizationId,
            actor: actorFromSystem(),
            source: "system",
            action: "integration.updated",
            resourceId: "integration_1",
            changes: {
              fields: ["apiKey", "name"],
              before: { apiKey: "sk_live_1", name: "Zendesk" },
              after: { apiKey: "sk_live_2", name: "Zendesk Support" },
            },
            metadata: { token: "sk_live_3" },
          })
          .pipe(Effect.provideService(AuditLogEnabled, true));

        const [row] = yield* rowsFor(organizationId);
        expect(row?.changes).toEqual({
          before: { apiKey: "[redacted]", name: "Zendesk" },
          after: { apiKey: "[redacted]", name: "Zendesk Support" },
          fields: ["apiKey", "name"],
        });
        expect(row?.metadata).toEqual({ token: "[redacted]" });
        expect(row?.actorUserId).toBeNull();
      })
    );

    it.effect(
      "fails loudly, and quietly on request, when the write cannot land",
      () =>
        Effect.gen(function* () {
          const recorder = yield* AuditLogRecorder;
          const organizationId = yield* createOrganization();

          // An allowed action carrying a denial reason violates the table's
          // own check constraint. That is the honest way to make the insert
          // fail: the recorder derives the resource type, so a writer cannot
          // produce a mismatched pair on its own, and `organization_id` has no
          // foreign key to violate.
          const invalid = {
            organizationId,
            actor: actorFromSystem(),
            source: "system" as const,
            action: "workspace.updated" as const,
            denialReason: "refused",
          };

          const failure = yield* Effect.flip(
            recorder
              .record(invalid)
              .pipe(Effect.provideService(AuditLogEnabled, true))
          );

          expect(failure._tag).toBe("EffectDrizzleQueryError");

          yield* recorder
            .recordBestEffort(invalid)
            .pipe(Effect.provideService(AuditLogEnabled, true));
        })
    );
  });
});
