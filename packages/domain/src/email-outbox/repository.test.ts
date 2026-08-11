import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema, transaction } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EmailOutboxRepository } from "./repository";

describe("EmailOutboxRepository", () => {
  const TestLayer = EmailOutboxRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.organizationTable).values({
        id,
        name: "Email outbox test workspace",
        slug: id,
        createdAt: new Date(),
      });
    });

  const submissionIntent = (organizationId: string, postId = "pst_test") => ({
    aggregateId: postId,
    aggregateType: "post",
    deduplicationKey: `submission.created:${organizationId}:${postId}`,
    expiresAt: null,
    kind: "submission.created" as const,
    organizationId,
    payload: { kind: "submission.created" as const, postId },
    scheduledAt: new Date("2026-08-09T00:00:00.000Z"),
  });

  layer(TestLayer)("repository", (it) => {
    it.effect("records one immutable intent for duplicate business keys", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailOutboxRepository;

        yield* createOrganization(organizationId);
        const first = yield* repository.recordIntent(
          submissionIntent(organizationId)
        );
        const duplicate = yield* repository.recordIntent(
          submissionIntent(organizationId)
        );

        expect(first._tag).toBe("Inserted");
        expect(duplicate).toEqual({ _tag: "Duplicate" });
        expect(
          yield* repository.findPending({
            before: new Date("2026-08-10"),
            organizationId,
          })
        ).toHaveLength(1);
      })
    );

    it.effect(
      "rejects a corrupt persisted intent payload with a typed error",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailOutboxRepository;
          const db = yield* currentDb;

          yield* createOrganization(organizationId);
          yield* db.insert(schema.emailOutboxTable).values({
            id: "eob_corrupt",
            organizationId,
            kind: "submission.created",
            aggregateType: "post",
            aggregateId: "pst_corrupt",
            deduplicationKey: `corrupt:${organizationId}`,
            payload: { kind: "submission.created", postId: 123 },
            scheduledAt: new Date("2026-08-09T00:00:00.000Z"),
            expiresAt: null,
            state: "pending",
          });

          const error = yield* Effect.flip(
            repository.findPending({
              before: new Date("2026-08-10"),
              organizationId,
            })
          );

          expect(error._tag).toBe("EmailOutboxDataError");
          if (error._tag === "EmailOutboxDataError") {
            expect(error.operation).toBe("findPending.decodeIntent");
          }
        })
    );

    it.effect(
      "coalesces pending status changes into their final payload only",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailOutboxRepository;
          const db = yield* currentDb;
          const scheduledAt = new Date("2026-08-09T12:05:00.000Z");

          yield* createOrganization(organizationId);
          yield* repository.upsertPendingStatusChange({
            aggregateId: "pst_status",
            aggregateType: "post",
            deduplicationKey: `post.status_changed:${organizationId}:pst_status:window`,
            expiresAt: new Date("2026-08-16T12:05:00.000Z"),
            organizationId,
            payload: {
              kind: "post.status_changed",
              postId: "pst_status",
              statusId: "pss_pending",
            },
            scheduledAt,
          });
          yield* repository.upsertPendingStatusChange({
            aggregateId: "pst_status",
            aggregateType: "post",
            deduplicationKey: `post.status_changed:${organizationId}:pst_status:window`,
            expiresAt: new Date("2026-08-16T12:05:00.000Z"),
            organizationId,
            payload: {
              kind: "post.status_changed",
              postId: "pst_status",
              statusId: "pss_completed",
            },
            scheduledAt: new Date("2026-08-09T12:09:00.000Z"),
          });

          const intents = yield* repository.findPending({
            before: new Date("2026-08-10"),
            organizationId,
          });

          expect(intents).toHaveLength(1);
          expect(intents[0]?.payload).toEqual({
            kind: "post.status_changed",
            postId: "pst_status",
            statusId: "pss_completed",
          });
          expect(intents[0]?.scheduledAt).toEqual(scheduledAt);

          yield* db
            .update(schema.emailOutboxTable)
            .set({ state: "materialized" })
            .where(
              eq(
                schema.emailOutboxTable.deduplicationKey,
                `post.status_changed:${organizationId}:pst_status:window`
              )
            );
          const repeatedWindow = yield* repository.upsertPendingStatusChange({
            aggregateId: "pst_status",
            aggregateType: "post",
            deduplicationKey: `post.status_changed:${organizationId}:pst_status:window`,
            expiresAt: new Date("2026-08-16T12:05:00.000Z"),
            organizationId,
            payload: {
              kind: "post.status_changed",
              postId: "pst_status",
              statusId: "pss_reopened",
            },
            scheduledAt,
          });

          expect(repeatedWindow).toEqual({ _tag: "AlreadyMaterialized" });

          const nextWindow = yield* repository.upsertPendingStatusChange({
            aggregateId: "pst_status",
            aggregateType: "post",
            deduplicationKey: `post.status_changed:${organizationId}:pst_status:next-window`,
            expiresAt: new Date("2026-08-16T12:05:00.000Z"),
            organizationId,
            payload: {
              kind: "post.status_changed",
              postId: "pst_status",
              statusId: "pss_reopened",
            },
            scheduledAt,
          });

          expect(nextWindow._tag).toBe("Written");
        })
    );

    it.effect(
      "keeps a product mutation and recorded intent in one transaction",
      () =>
        Effect.gen(function* () {
          const repository = yield* EmailOutboxRepository;
          const organizationId = yield* WorkspaceId.generate;
          const commitId = yield* WorkspaceId.generate;

          yield* Effect.flip(
            transaction(
              Effect.gen(function* () {
                yield* createOrganization(organizationId);
                yield* repository.recordIntent(
                  submissionIntent(organizationId)
                );
                return yield* Effect.fail(
                  "abort email outbox test transaction"
                );
              })
            )
          );

          const db = yield* currentDb;
          const rolledBackOrganizations = yield* db
            .select({ id: schema.organizationTable.id })
            .from(schema.organizationTable)
            .where(eq(schema.organizationTable.id, organizationId));
          const rolledBackIntents = yield* db
            .select({ id: schema.emailOutboxTable.id })
            .from(schema.emailOutboxTable)
            .where(eq(schema.emailOutboxTable.organizationId, organizationId));

          expect(rolledBackOrganizations).toEqual([]);
          expect(rolledBackIntents).toEqual([]);

          yield* transaction(
            Effect.gen(function* () {
              yield* createOrganization(commitId);
              yield* repository.recordIntent(submissionIntent(commitId));
            })
          );

          const committedIntents = yield* db
            .select({ id: schema.emailOutboxTable.id })
            .from(schema.emailOutboxTable)
            .where(eq(schema.emailOutboxTable.organizationId, commitId));
          expect(committedIntents).toHaveLength(1);
        })
    );
  });
});
