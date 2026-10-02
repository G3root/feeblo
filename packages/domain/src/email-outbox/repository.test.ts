import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema, transaction } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { submissionWindowMaxPosts } from "./config";
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
      "opens one submission window per burst and slides it until the ceiling",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailOutboxRepository;

          yield* createOrganization(organizationId);
          const opened = yield* repository.upsertPendingSubmissionWindow({
            now: new Date("2026-08-09T10:02:00.000Z"),
            organizationId,
            postId: "pst_first",
          });
          if (opened._tag !== "Written") {
            return yield* Effect.die("Expected an opened window");
          }

          const [first] = yield* repository.findPending({
            before: new Date("2026-08-10"),
            organizationId,
          });
          expect(first?.payload).toEqual({
            kind: "submission.created",
            postCount: 1,
            postId: "pst_first",
            postIds: ["pst_first"],
          });
          // The key is bucketed by the burst delay, so two simultaneous first
          // submissions in the same five minutes converge on one row.
          expect(first?.deduplicationKey).toBe(
            `submission.created:${organizationId}:${new Date(
              "2026-08-09T10:00:00.000Z"
            ).getTime()}`
          );
          expect(first?.scheduledAt).toEqual(
            new Date("2026-08-09T10:07:00.000Z")
          );

          const appended = yield* repository.upsertPendingSubmissionWindow({
            now: new Date("2026-08-09T10:04:00.000Z"),
            organizationId,
            postId: "pst_second",
          });
          expect(appended).toEqual({
            _tag: "Written",
            intentId: opened.intentId,
          });

          const [slid] = yield* repository.findPending({
            before: new Date("2026-08-10"),
            organizationId,
          });
          expect(slid?.payload).toEqual({
            kind: "submission.created",
            postCount: 2,
            postId: "pst_first",
            postIds: ["pst_first", "pst_second"],
          });
          expect(slid?.scheduledAt).toEqual(
            new Date("2026-08-09T10:09:00.000Z")
          );

          // A quiet workspace would keep sliding; a busy one stops at one hour
          // after the window opened rather than postponing the email forever.
          yield* repository.upsertPendingSubmissionWindow({
            now: new Date("2026-08-09T11:00:00.000Z"),
            organizationId,
            postId: "pst_third",
          });
          const [capped] = yield* repository.findPending({
            before: new Date("2026-08-11"),
            organizationId,
          });
          expect(capped?.scheduledAt).toEqual(
            new Date("2026-08-09T11:02:00.000Z")
          );
          expect(capped?.id).toBe(opened.intentId);
        })
    );

    it.effect("is idempotent for a post already in the window", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailOutboxRepository;

        yield* createOrganization(organizationId);
        const opened = yield* repository.upsertPendingSubmissionWindow({
          now: new Date("2026-08-09T10:02:00.000Z"),
          organizationId,
          postId: "pst_replay",
        });
        const replay = yield* repository.upsertPendingSubmissionWindow({
          now: new Date("2026-08-09T10:03:00.000Z"),
          organizationId,
          postId: "pst_replay",
        });

        expect(replay).toEqual({ _tag: "Duplicate" });
        const [intent] = yield* repository.findPending({
          before: new Date("2026-08-10"),
          organizationId,
        });
        expect(intent?.id).toBe(opened.intentId);
        expect(intent?.payload).toEqual({
          kind: "submission.created",
          postCount: 1,
          postId: "pst_replay",
          postIds: ["pst_replay"],
        });
        expect(intent?.scheduledAt).toEqual(
          new Date("2026-08-09T10:07:00.000Z")
        );
      })
    );

    it.effect("opens the next window once the previous one is terminal", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailOutboxRepository;
        const db = yield* currentDb;

        yield* createOrganization(organizationId);
        const first = yield* repository.upsertPendingSubmissionWindow({
          now: new Date("2026-08-09T10:02:00.000Z"),
          organizationId,
          postId: "pst_sent",
        });
        if (first._tag !== "Written") {
          return yield* Effect.die("Expected an opened window");
        }
        yield* db
          .update(schema.emailOutboxTable)
          .set({ state: "materialized" })
          .where(eq(schema.emailOutboxTable.id, first.intentId));

        const next = yield* repository.upsertPendingSubmissionWindow({
          now: new Date("2026-08-09T10:06:00.000Z"),
          organizationId,
          postId: "pst_next",
        });

        expect(next._tag).toBe("Written");
        expect(next.intentId).not.toBe(first.intentId);
        const [intent] = yield* repository.findPending({
          before: new Date("2026-08-10"),
          organizationId,
        });
        expect(intent?.payload).toEqual({
          kind: "submission.created",
          postCount: 1,
          postId: "pst_next",
          postIds: ["pst_next"],
        });
      })
    );

    it.effect("keeps counting past the stored id cap on one window", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailOutboxRepository;
        const db = yield* currentDb;
        const openedAt = new Date("2026-08-09T10:02:00.000Z");
        const fullPostIds = Array.from(
          { length: submissionWindowMaxPosts },
          (_, index) => `pst_full_${index}`
        );

        yield* createOrganization(organizationId);
        yield* db.insert(schema.emailOutboxTable).values({
          id: "eob_full_window",
          organizationId,
          kind: "submission.created",
          aggregateType: "post",
          aggregateId: "pst_full_0",
          deduplicationKey: `submission.created:${organizationId}:seeded`,
          payload: {
            kind: "submission.created",
            postCount: fullPostIds.length,
            postId: "pst_full_0",
            postIds: fullPostIds,
          },
          scheduledAt: new Date("2026-08-09T10:07:00.000Z"),
          expiresAt: null,
          state: "pending",
          createdAt: openedAt,
          updatedAt: openedAt,
        });

        const overflowed = yield* repository.upsertPendingSubmissionWindow({
          now: new Date("2026-08-09T10:04:00.000Z"),
          organizationId,
          postId: "pst_after_full",
        });

        // One window per burst is the flood bound, so overflowing the stored
        // ids must not open a second one. The email summarises by count anyway.
        expect(overflowed).toEqual({
          _tag: "Written",
          intentId: "eob_full_window",
        });
        const [intent] = yield* repository.findPending({
          before: new Date("2026-08-10"),
          organizationId,
        });
        expect(intent?.payload).toEqual({
          kind: "submission.created",
          postCount: submissionWindowMaxPosts + 1,
          postId: "pst_full_0",
          postIds: fullPostIds,
        });
        expect(intent?.scheduledAt).toEqual(
          new Date("2026-08-09T10:09:00.000Z")
        );
      })
    );

    it.effect(
      "opens an unbucketed key when the bucket already holds a sent window",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailOutboxRepository;
          const db = yield* currentDb;
          const now = new Date("2026-08-09T10:02:00.000Z");
          const bucketStart = new Date("2026-08-09T10:00:00.000Z").getTime();

          yield* createOrganization(organizationId);
          yield* db.insert(schema.emailOutboxTable).values({
            id: "eob_sent_bucket",
            organizationId,
            kind: "submission.created",
            aggregateType: "post",
            aggregateId: "pst_sent_bucket",
            deduplicationKey: `submission.created:${organizationId}:${bucketStart}`,
            payload: {
              kind: "submission.created",
              postCount: 1,
              postIds: ["pst_sent_bucket"],
            },
            scheduledAt: new Date("2026-08-09T10:07:00.000Z"),
            expiresAt: null,
            state: "materialized",
            createdAt: now,
            updatedAt: now,
          });

          const opened = yield* repository.upsertPendingSubmissionWindow({
            now,
            organizationId,
            postId: "pst_next_in_bucket",
          });

          expect(opened._tag).toBe("Written");
          const [intent] = yield* repository.findPending({
            before: new Date("2026-08-10"),
            organizationId,
          });
          expect(intent?.deduplicationKey).toBe(
            `submission.created:${organizationId}:${bucketStart}:${now.getTime()}`
          );
          expect(intent?.payload).toEqual({
            kind: "submission.created",
            postCount: 1,
            postId: "pst_next_in_bucket",
            postIds: ["pst_next_in_bucket"],
          });
        })
    );

    it.effect(
      "opens the next window when the bucket key belongs to another intent kind",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailOutboxRepository;
          const db = yield* currentDb;
          const now = new Date("2026-08-09T10:02:00.000Z");
          const bucketStart = new Date("2026-08-09T10:00:00.000Z").getTime();

          yield* createOrganization(organizationId);
          // Same deduplication key, different kind: the pending-window lookup
          // misses it, so the bucketed insert conflicts and the read-back has
          // to reject the row as unappendable rather than write a submission
          // into a changelog intent.
          yield* db.insert(schema.emailOutboxTable).values({
            id: "eob_other_kind",
            organizationId,
            kind: "changelog.published",
            aggregateType: "changelog",
            aggregateId: "chl_bucket",
            deduplicationKey: `submission.created:${organizationId}:${bucketStart}`,
            payload: { kind: "changelog.published", changelogId: "chl_bucket" },
            scheduledAt: now,
            expiresAt: null,
            state: "pending",
            createdAt: now,
            updatedAt: now,
          });

          const opened = yield* repository.upsertPendingSubmissionWindow({
            now,
            organizationId,
            postId: "pst_other_kind",
          });
          if (opened._tag !== "Written") {
            return yield* Effect.die("Expected an opened window");
          }

          const intent = yield* repository.findById(opened.intentId);
          expect(intent?.deduplicationKey).toBe(
            `submission.created:${organizationId}:${bucketStart}:${now.getTime()}`
          );
          expect(intent?.payload).toEqual({
            kind: "submission.created",
            postCount: 1,
            postId: "pst_other_kind",
            postIds: ["pst_other_kind"],
          });
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
