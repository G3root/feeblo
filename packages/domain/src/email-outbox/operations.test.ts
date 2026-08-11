import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EmailOutboxOperations } from "./operations";

const TestLayer = EmailOutboxOperations.layer.pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

describe("EmailOutboxOperations", () => {
  layer(TestLayer)("inspection", (it) => {
    it.effect(
      "reports inspectable state counts and oldest queued age by workspace",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const operations = yield* EmailOutboxOperations;
          const organizationId = yield* WorkspaceId.generate;
          const now = new Date("2026-08-09T12:00:00.000Z");
          const createdAt = new Date(now.getTime() - 120_000);
          const failedCreatedAt = new Date(now.getTime() - 600_000);
          yield* db.insert(schema.organizationTable).values({
            id: organizationId,
            name: "Outbox operations",
            slug: organizationId,
            createdAt,
          });
          yield* db.insert(schema.emailOutboxTable).values({
            id: `eob_${organizationId}`,
            organizationId,
            kind: "submission.created",
            aggregateType: "post",
            aggregateId: "pst_ops",
            deduplicationKey: `ops:${organizationId}`,
            payload: { kind: "submission.created", postId: "pst_ops" },
            scheduledAt: createdAt,
            expiresAt: null,
            state: "materialized",
            createdAt,
            updatedAt: createdAt,
          });
          yield* db.insert(schema.emailDeliveryTable).values([
            {
              id: `edl_queued_${organizationId}`,
              outboxId: `eob_${organizationId}`,
              contactId: null,
              recipientEmail: "queued@example.com",
              template: "notification",
              templateVersion: 1,
              templatePayload: {},
              messageId: `<queued.${organizationId}@notifications.feeblo>`,
              state: "queued",
              attemptCount: 0,
              nextAttemptAt: null,
              acceptedAt: null,
              deliveredAt: null,
              lastError: null,
              providerMetadata: null,
              createdAt,
              updatedAt: createdAt,
            },
            {
              id: `edl_failed_${organizationId}`,
              outboxId: `eob_${organizationId}`,
              contactId: null,
              recipientEmail: "failed@example.com",
              template: "notification",
              templateVersion: 1,
              templatePayload: {},
              messageId: `<failed.${organizationId}@notifications.feeblo>`,
              state: "failed",
              attemptCount: 5,
              nextAttemptAt: null,
              acceptedAt: null,
              deliveredAt: null,
              lastError: { tag: "retry_exhausted" },
              providerMetadata: null,
              createdAt: failedCreatedAt,
              updatedAt: failedCreatedAt,
            },
          ]);

          const snapshot = yield* operations.inspect({ organizationId, now });
          expect(snapshot.intentStates.materialized).toBe(1);
          expect(snapshot.deliveryStates.queued).toBe(1);
          expect(snapshot.deliveryStates.failed).toBe(1);
          expect(snapshot.oldestQueuedAgeMs).toBe(120_000);
        })
    );

    it.effect(
      "reports no queued age when an organization has only terminal deliveries",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const operations = yield* EmailOutboxOperations;
          const organizationId = yield* WorkspaceId.generate;
          const now = new Date("2026-08-09T12:00:00.000Z");
          yield* db.insert(schema.organizationTable).values({
            id: organizationId,
            name: "Terminal outbox operations",
            slug: organizationId,
            createdAt: now,
          });
          yield* db.insert(schema.emailOutboxTable).values({
            id: `eob_${organizationId}`,
            organizationId,
            kind: "submission.created",
            aggregateType: "post",
            aggregateId: "pst_terminal_ops",
            deduplicationKey: `terminal-ops:${organizationId}`,
            payload: { kind: "submission.created", postId: "pst_terminal_ops" },
            scheduledAt: now,
            expiresAt: null,
            state: "materialized",
          });
          yield* db.insert(schema.emailDeliveryTable).values({
            id: `edl_failed_${organizationId}`,
            outboxId: `eob_${organizationId}`,
            contactId: null,
            recipientEmail: "terminal@example.com",
            template: "notification",
            templateVersion: 1,
            templatePayload: {},
            messageId: `<terminal.${organizationId}@notifications.feeblo>`,
            state: "failed",
            attemptCount: 5,
            nextAttemptAt: null,
            acceptedAt: null,
            deliveredAt: null,
            lastError: { tag: "retry_exhausted" },
            providerMetadata: null,
          });

          const snapshot = yield* operations.inspect({ organizationId, now });
          expect(snapshot.oldestQueuedAgeMs).toBeNull();
        })
    );
  });
});
