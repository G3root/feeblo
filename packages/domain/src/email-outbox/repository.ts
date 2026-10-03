import { createHash } from "node:crypto";

import { Database, schema } from "@feeblo/db";
import { EmailDeliveryId, EmailOutboxId } from "@feeblo/id";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  type EmailAddress,
  parseEmailAddress,
} from "../email-subscription/schema";
import {
  submissionWindowBurst,
  submissionWindowCeiling,
  submissionWindowMaxPosts,
} from "./config";
import { deliverySourceStatesFor } from "./delivery-state";
import {
  type EmailDeliveryRecord as EmailDelivery,
  EmailDeliveryRecord,
  type EmailOutboxRecord as EmailIntent,
  EmailIntentPayload,
  EmailOutboxRecord,
  type EmailIntentPayload as IntentPayload,
  submissionWindowPostCount,
  submissionWindowPostIds,
} from "./schema";
import {
  recordEmailDeliveryTransition,
  recordEmailIntentTransition,
  recordEmailReconciliationRecoveries,
} from "./telemetry";

export class EmailOutboxDataError extends Schema.TaggedError<EmailOutboxDataError>()(
  "EmailOutboxDataError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

type EmailIntentWriteFields = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly deduplicationKey: string;
  readonly expiresAt: Date | null;
  readonly organizationId: string;
  readonly scheduledAt: Date;
};

type EncodedIntentPayload = Schema.Codec.Encoded<typeof EmailIntentPayload>;

/** Raw value space of rows read back from the outbox/delivery tables. */

export type RecordEmailIntentInput = EmailIntentWriteFields & {
  readonly kind: Exclude<EmailIntent["kind"], "post.status_changed">;
  readonly payload: Exclude<
    EncodedIntentPayload,
    { readonly kind: "post.status_changed" }
  >;
};

export type RecordStatusChangeIntentInput = EmailIntentWriteFields & {
  readonly payload: Extract<
    EncodedIntentPayload,
    { readonly kind: "post.status_changed" }
  >;
};

/** One submission joining its workspace's pending notification window. */
export type RecordSubmissionWindowInput = {
  /** The instant the submission is recorded; bounds the window's slide. */
  readonly now: Date;
  readonly organizationId: string;
  readonly postId: string;
};

/**
 * Outcome of joining a submission window. `Duplicate` means the post is
 * already stored in this window, so replaying its create writes nothing.
 * Past the window's stored-id cap a replay is not stored, so it increments
 * `postCount` instead — no second email either way, but the summary then
 * counts that submission twice; that is accepted, because the cap exists
 * exactly where per-post exactness stops mattering.
 */
export type UpsertSubmissionWindowResult =
  | { readonly _tag: "Written"; readonly intentId: string }
  | { readonly _tag: "Duplicate" };

export type CreateEmailDeliveryInput = {
  readonly contactId?: string | null;
  readonly outboxId: string;
  readonly recipientEmail: string;
  readonly template: EmailDelivery["template"];
  readonly templatePayload: unknown;
  readonly templateVersion: number;
};

export interface FindPendingEmailIntentsInput {
  readonly before: Date;
  readonly limit?: number;
  readonly organizationId?: string;
}

export interface FindDueEmailDeliveriesInput {
  readonly before: Date;
  readonly limit?: number;
  readonly staleSendingBefore: Date;
}

/** A paused delivery resumed into `queued`, with the version that resume wrote. */
export type ResumedEmailDelivery = {
  readonly attemptCount: number;
  readonly id: string;
  readonly transitionVersion: number;
};

const dataError = (operation: string, reason: string): EmailOutboxDataError =>
  new EmailOutboxDataError({ operation, reason });

/**
 * SQL expression that advances a delivery's transition version.
 *
 * `deliveryElementId` derives the persisted-queue element id from it, so it has
 * to change on every state transition that can be followed by a re-offer.
 */
const nextTransitionVersion = sql`${schema.emailDeliveryTable.transitionVersion} + 1`;

/**
 * The columns appending to a window needs from its row.
 *
 * The pending-window lookup and the insert-conflict read-back both project
 * this shape, and both hand it to the same append.
 */
const submissionWindowAppendColumns = {
  createdAt: schema.emailOutboxTable.createdAt,
  id: schema.emailOutboxTable.id,
  payload: schema.emailOutboxTable.payload,
};

/**
 * Bucket width used for a new submission window's deduplication key.
 *
 * Two submissions that find no pending window at the same moment derive the
 * same key and the unique index collapses them into one window; without a
 * bucket every concurrent first submission would open its own.
 */
const submissionWindowBucketMs = Duration.toMillis(submissionWindowBurst);

const decodeIntentPayload = (
  input: Schema.Codec.Encoded<typeof EmailIntentPayload>,
  operation: string
): Effect.Effect<IntentPayload, EmailOutboxDataError> =>
  Schema.decodeEffect(EmailIntentPayload)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email intent payload is invalid")
    )
  );

const decodeEmailIntent = (
  input: Schema.Codec.Encoded<typeof EmailOutboxRecord>,
  operation: string
): Effect.Effect<EmailIntent, EmailOutboxDataError> =>
  Effect.gen(function* () {
    const intent = yield* Schema.decodeEffect(EmailOutboxRecord)(input).pipe(
      Effect.mapError(() =>
        dataError(operation, "Stored email intent record is invalid")
      )
    );

    if (intent.kind !== intent.payload.kind) {
      return yield* dataError(
        operation,
        "Stored email intent kind does not match its payload"
      );
    }

    return intent;
  });

const decodeEmailDelivery = (
  input: Schema.Codec.Encoded<typeof EmailDeliveryRecord>,
  operation: string
): Effect.Effect<EmailDelivery, EmailOutboxDataError> =>
  Schema.decodeEffect(EmailDeliveryRecord)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email delivery record is invalid")
    )
  );

const normalizeRecipientEmail = (
  recipientEmail: string
): Effect.Effect<EmailAddress, EmailOutboxDataError> =>
  parseEmailAddress(recipientEmail, "createDelivery").pipe(
    Effect.mapError(() =>
      dataError("createDelivery", "Recipient email is invalid")
    )
  );

/** Deterministic, non-PII RFC message identifier for one outbox recipient. */
export const emailDeliveryMessageId = (
  outboxId: string,
  recipientEmail: string
): string => {
  const recipientHash = createHash("sha256")
    .update(`${outboxId}:${recipientEmail}`)
    .digest("hex");
  return `<email.${recipientHash}@notifications.feeblo>`;
};

const makeEmailOutboxRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  /**
   * Locks the organization row until the caller's transaction ends.
   *
   * The same device the roadmap repository uses for its per-organization
   * invariants: a condition that spans rows cannot be enforced by row locks on
   * those rows, because a lookup that matches nothing proves nothing. See
   * `upsertPendingSubmissionWindow` for what it serializes here.
   */
  const lockOrganization = (organizationId: string) =>
    db.execute(
      sql`SELECT id FROM ${schema.organizationTable} WHERE id = ${organizationId} FOR UPDATE`
    );

  const recordIntent = Effect.fn("EmailOutboxRepository.recordIntent")(
    function* (input: RecordEmailIntentInput) {
      const payload = yield* decodeIntentPayload(
        // SAFETY: the write payload is the encoded intent shape; the decoder
        // re-validates the tag union before it is used.
        input.payload as Schema.Codec.Encoded<typeof EmailIntentPayload>,
        "recordIntent.decodePayload"
      );
      if (payload.kind !== input.kind) {
        return yield* dataError(
          "recordIntent.decodePayload",
          "Email intent kind does not match its payload"
        );
      }

      const id = yield* EmailOutboxId.generate;
      const [inserted] = yield* db
        .insert(schema.emailOutboxTable)
        .values({
          id,
          organizationId: input.organizationId,
          kind: input.kind,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          deduplicationKey: input.deduplicationKey,
          payload,
          scheduledAt: input.scheduledAt,
          expiresAt: input.expiresAt,
          state: "pending",
        })
        .onConflictDoNothing({
          target: [
            schema.emailOutboxTable.organizationId,
            schema.emailOutboxTable.deduplicationKey,
          ],
        })
        .returning();

      if (!inserted) {
        return { _tag: "Duplicate" as const };
      }

      yield* recordEmailIntentTransition(input.kind, "pending");

      return {
        _tag: "Inserted" as const,
        intent: yield* decodeEmailIntent(
          // SAFETY: the stored row is the encoded outbox record; the decoder
          // re-validates it before it is used.
          inserted as Schema.Codec.Encoded<typeof EmailOutboxRecord>,
          "recordIntent.decodeResult"
        ),
      };
    }
  );

  const upsertPendingStatusChange = Effect.fn(
    "EmailOutboxRepository.upsertPendingStatusChange"
  )(function* (input: RecordStatusChangeIntentInput) {
    const payload = yield* decodeIntentPayload(
      // SAFETY: the write payload is the encoded intent shape; the decoder
      // re-validates the tag union before it is used.
      input.payload as Schema.Codec.Encoded<typeof EmailIntentPayload>,
      "upsertPendingStatusChange.decodePayload"
    );
    if (payload.kind !== "post.status_changed") {
      return yield* dataError(
        "upsertPendingStatusChange.decodePayload",
        "Status coalescing only accepts post.status_changed payloads"
      );
    }

    const id = yield* EmailOutboxId.generate;
    const values = {
      id,
      organizationId: input.organizationId,
      kind: "post.status_changed" as const,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      deduplicationKey: input.deduplicationKey,
      payload,
      scheduledAt: input.scheduledAt,
      expiresAt: input.expiresAt,
      state: "pending" as const,
    };
    const [inserted] = yield* db
      .insert(schema.emailOutboxTable)
      .values(values)
      .onConflictDoNothing()
      .returning();

    if (inserted !== undefined) {
      yield* recordEmailIntentTransition("post.status_changed", "pending");
      return {
        _tag: "Written" as const,
        intent: yield* decodeEmailIntent(
          // SAFETY: the stored row is the encoded outbox record; the decoder
          // re-validates it before it is used.
          inserted as Schema.Codec.Encoded<typeof EmailOutboxRecord>,
          "upsertPendingStatusChange.decodeResult"
        ),
      };
    }

    const updatedAt = yield* DateTime.nowAsDate;
    const [coalesced] = yield* db
      .update(schema.emailOutboxTable)
      .set({ payload, updatedAt })
      .where(
        and(
          eq(schema.emailOutboxTable.organizationId, input.organizationId),
          eq(schema.emailOutboxTable.kind, "post.status_changed"),
          eq(schema.emailOutboxTable.aggregateId, input.aggregateId),
          eq(schema.emailOutboxTable.state, "pending")
        )
      )
      .returning();

    if (coalesced !== undefined) {
      return {
        _tag: "Written" as const,
        intent: yield* decodeEmailIntent(
          // SAFETY: the stored row is the encoded outbox record; the decoder
          // re-validates it before it is used.
          coalesced as Schema.Codec.Encoded<typeof EmailOutboxRecord>,
          "upsertPendingStatusChange.decodeResult"
        ),
      };
    }

    // The pending row may have materialized between the insert conflict and
    // guarded update. A second conflict-safe insert opens the next window when
    // the business key is new, while the stable deduplication key still blocks
    // replay of the materialized window.
    const [retried] = yield* db
      .insert(schema.emailOutboxTable)
      .values(values)
      .onConflictDoNothing()
      .returning();

    if (retried !== undefined) {
      yield* recordEmailIntentTransition("post.status_changed", "pending");
      return {
        _tag: "Written" as const,
        intent: yield* decodeEmailIntent(
          // SAFETY: the stored row is the encoded outbox record; the decoder
          // re-validates it before it is used.
          retried as Schema.Codec.Encoded<typeof EmailOutboxRecord>,
          "upsertPendingStatusChange.decodeResult"
        ),
      };
    }

    const [existingWindow] = yield* db
      .select({ id: schema.emailOutboxTable.id })
      .from(schema.emailOutboxTable)
      .where(
        and(
          eq(schema.emailOutboxTable.organizationId, input.organizationId),
          eq(schema.emailOutboxTable.deduplicationKey, input.deduplicationKey)
        )
      )
      .limit(1);

    return existingWindow === undefined
      ? yield* dataError(
          "upsertPendingStatusChange",
          "Could not resolve a concurrent status intent conflict"
        )
      : { _tag: "AlreadyMaterialized" as const };
  });

  /**
   * Joins one submission to its workspace's pending notification window.
   *
   * Submissions coalesce by workspace rather than by post: a workspace has at
   * most one pending window, every submission appends to it, and the window's
   * `scheduledAt` slides to `now + submissionWindowBurst` without ever passing
   * `createdAt + submissionWindowCeiling`. A burst therefore sends one email
   * `submissionWindowBurst` after the last post, and a sustained flood is
   * bounded to one email per window per hour instead of one per submission.
   *
   * The locked read is what makes concurrent submissions join the same window:
   * a second transaction blocks on the row until the first commits, so it sees
   * the appended post rather than opening a competing window. When no window is
   * pending, the insert key is bucketed by `submissionWindowBurst` so that two
   * simultaneous first submissions still converge on one row through the
   * `(organizationId, deduplicationKey)` unique index.
   *
   * `aggregateId` names the post that opened the window. It is not the set of
   * notified posts (that is `postIds`, which grows), but it keeps the intent
   * under the post-attributed access gate and gives delivery telemetry a
   * stable post reference.
   */
  const upsertPendingSubmissionWindow = Effect.fn(
    "EmailOutboxRepository.upsertPendingSubmissionWindow"
  )(function* ({ now, organizationId, postId }: RecordSubmissionWindowInput) {
    const nowInstant = DateTime.fromDateUnsafe(now);
    const burstAt = DateTime.addDuration(nowInstant, submissionWindowBurst);

    // Serializes window creation per workspace across transactions. Two posts
    // created together otherwise race past the pending-window lookup below —
    // which locks nothing when no window exists — and can each open their own
    // window across a burst-boundary instant, doubling the workspace's email
    // rate. The organization row is the same lock the roadmap repository uses
    // for its per-organization invariants; taken here it holds to the end of
    // the caller's transaction, so the second submission's lookup sees the
    // first one's window and appends instead of opening another.
    yield* lockOrganization(organizationId);

    /**
     * Appends this submission to a locked window row.
     *
     * Returns `undefined` when the row is not an appendable submission window —
     * another intent kind, or one whose state left `pending` before this write —
     * so the caller opens the next window instead of writing into a sent one.
     * A re-read of the same post id is a `Duplicate`: it already has its place.
     */
    const appendToWindow = (row: {
      readonly createdAt: Date;
      readonly id: string;
      readonly payload: unknown;
    }) =>
      Effect.gen(function* () {
        const payload = yield* decodeIntentPayload(
          // SAFETY: the stored row is the encoded intent payload; the decoder
          // re-validates the tag union before it is used.
          row.payload as Schema.Codec.Encoded<typeof EmailIntentPayload>,
          "upsertPendingSubmissionWindow.decodePayload"
        );
        if (payload.kind !== "submission.created") {
          return undefined;
        }
        const windowPostIds = submissionWindowPostIds(payload);
        if (windowPostIds.includes(postId)) {
          return { _tag: "Duplicate" as const };
        }
        const ceilingAt = DateTime.addDuration(
          DateTime.fromDateUnsafe(row.createdAt),
          submissionWindowCeiling
        );
        const updatedAt = yield* DateTime.nowAsDate;
        const rows = yield* db
          .update(schema.emailOutboxTable)
          .set({
            payload: {
              kind: "submission.created" as const,
              // The opener is preserved across every write so a worker still
              // running the previous release can decode and send this window
              // at all; see the `postId` vocabulary comment for the accepted
              // failure mode when the opener is deleted first.
              postId: payload.postId ?? windowPostIds[0] ?? postId,
              // Past the id cap the window keeps counting without storing, so
              // a flood cannot open a second window by overflowing this one.
              postIds:
                windowPostIds.length < submissionWindowMaxPosts
                  ? [...windowPostIds, postId]
                  : windowPostIds,
              postCount: submissionWindowPostCount(payload) + 1,
            },
            // A quiet workspace sends five minutes after its last submission;
            // a busy one stops sliding an hour after the window opened.
            scheduledAt: DateTime.toDateUtc(DateTime.min(burstAt, ceilingAt)),
            updatedAt,
          })
          .where(
            and(
              eq(schema.emailOutboxTable.id, row.id),
              eq(schema.emailOutboxTable.state, "pending")
            )
          )
          .returning({ id: schema.emailOutboxTable.id });

        const updated = rows[0];
        return updated === undefined
          ? undefined
          : { _tag: "Written" as const, intentId: updated.id };
      });

    const [pending] = yield* db
      .select(submissionWindowAppendColumns)
      .from(schema.emailOutboxTable)
      .where(
        and(
          eq(schema.emailOutboxTable.organizationId, organizationId),
          eq(schema.emailOutboxTable.kind, "submission.created"),
          eq(schema.emailOutboxTable.state, "pending")
        )
      )
      .orderBy(schema.emailOutboxTable.createdAt)
      .limit(1)
      .for("update");

    if (pending !== undefined) {
      const appended = yield* appendToWindow(pending);
      if (appended !== undefined) {
        return appended;
      }
    }

    const outboxId = yield* EmailOutboxId.generate;
    const payload = {
      kind: "submission.created" as const,
      postId,
      postCount: 1,
      postIds: [postId],
    };
    const insertWindow = (deduplicationKey: string) =>
      db
        .insert(schema.emailOutboxTable)
        .values({
          id: outboxId,
          organizationId,
          kind: "submission.created" as const,
          aggregateType: "post",
          aggregateId: postId,
          deduplicationKey,
          payload,
          scheduledAt: DateTime.toDateUtc(burstAt),
          expiresAt: null,
          state: "pending" as const,
          // The window's own open instant, not the row's audit default: the
          // ceiling above is measured from it, and it has to be the same clock
          // the sliding `now` comes from.
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: schema.emailOutboxTable.id });

    const bucketStart =
      Math.floor(
        DateTime.toEpochMillis(nowInstant) / submissionWindowBucketMs
      ) * submissionWindowBucketMs;
    const bucketedKey = `submission.created:${organizationId}:${bucketStart}`;
    let inserted = (yield* insertWindow(bucketedKey))[0];
    if (inserted === undefined) {
      // The bucketed key is taken. That row is this bucket's window, or one
      // that already reached a terminal state in it — which a window cannot do
      // within its own bucket, because its send never precedes the bucket's
      // end, so a terminal row here means the clock moved. A concurrent
      // submission can also have committed a pending window between the read
      // above and this insert; appending to it in either case keeps one window
      // per burst, where a timestamped key on top of a pending window would
      // send the same submissions twice.
      const [conflicting] = yield* db
        .select(submissionWindowAppendColumns)
        .from(schema.emailOutboxTable)
        .where(
          and(
            eq(schema.emailOutboxTable.organizationId, organizationId),
            eq(schema.emailOutboxTable.deduplicationKey, bucketedKey)
          )
        )
        .limit(1)
        .for("update");
      if (conflicting !== undefined) {
        const appended = yield* appendToWindow(conflicting);
        if (appended !== undefined) {
          return appended;
        }
      }
      inserted = (yield* insertWindow(
        `${bucketedKey}:${DateTime.toEpochMillis(nowInstant)}`
      ))[0];
    }

    if (inserted === undefined) {
      return yield* dataError(
        "upsertPendingSubmissionWindow",
        "Could not open a submission notification window"
      );
    }

    yield* recordEmailIntentTransition("submission.created", "pending");
    return { _tag: "Written" as const, intentId: inserted.id };
  });

  const findPending = Effect.fn("EmailOutboxRepository.findPending")(
    function* ({
      before,
      limit = 100,
      organizationId,
    }: FindPendingEmailIntentsInput) {
      const rows = yield* db
        .select()
        .from(schema.emailOutboxTable)
        .where(
          and(
            eq(schema.emailOutboxTable.state, "pending"),
            lte(schema.emailOutboxTable.scheduledAt, before),
            ...(organizationId
              ? [eq(schema.emailOutboxTable.organizationId, organizationId)]
              : [])
          )
        )
        .orderBy(schema.emailOutboxTable.scheduledAt)
        .limit(limit);

      return yield* Effect.forEach(rows, (row) =>
        decodeEmailIntent(
          // SAFETY: the stored row is the encoded outbox record; the decoder
          // re-validates it before it is used.
          row as Schema.Codec.Encoded<typeof EmailOutboxRecord>,
          "findPending.decodeIntent"
        )
      );
    }
  );

  const findPausedByPlan = Effect.fn("EmailOutboxRepository.findPausedByPlan")(
    function* ({
      before,
      limit = 100,
    }: {
      readonly before: Date;
      readonly limit?: number;
    }) {
      const rows = yield* db
        .select()
        .from(schema.emailOutboxTable)
        .where(
          and(
            eq(schema.emailOutboxTable.state, "paused_by_plan"),
            lte(schema.emailOutboxTable.scheduledAt, before)
          )
        )
        .orderBy(schema.emailOutboxTable.scheduledAt)
        .limit(limit);
      return yield* Effect.forEach(rows, (row) =>
        decodeEmailIntent(
          // SAFETY: the stored row is the encoded outbox record; the decoder
          // re-validates it before it is used.
          row as Schema.Codec.Encoded<typeof EmailOutboxRecord>,
          "findPausedByPlan.decodeIntent"
        )
      );
    }
  );

  const findById = Effect.fn("EmailOutboxRepository.findById")(function* (
    id: string
  ) {
    const row = yield* db.query.emailOutboxTable.findFirst({ where: { id } });
    return row
      ? yield* decodeEmailIntent(
          // SAFETY: the stored row is the encoded outbox record; the decoder
          // re-validates it before it is used.
          row as Schema.Codec.Encoded<typeof EmailOutboxRecord>,
          "findById.decodeIntent"
        )
      : undefined;
  });

  /**
   * Reads one intent while holding its row lock.
   *
   * Materialization uses this so a concurrent append to the same window
   * serializes behind it: the appender's guarded update sees the state flip and
   * opens the next window instead of writing into one that is already being
   * sent. The caller must already be inside a transaction, or the lock is
   * released before the state flip it is meant to protect.
   */
  const findByIdForUpdate = Effect.fn(
    "EmailOutboxRepository.findByIdForUpdate"
  )(function* (id: string) {
    const [row] = yield* db
      .select()
      .from(schema.emailOutboxTable)
      .where(eq(schema.emailOutboxTable.id, id))
      .limit(1)
      .for("update");
    return row === undefined
      ? undefined
      : yield* decodeEmailIntent(
          // SAFETY: the stored row is the encoded outbox record; the decoder
          // re-validates it before it is used.
          row as Schema.Codec.Encoded<typeof EmailOutboxRecord>,
          "findByIdForUpdate.decodeIntent"
        );
  });

  const findDeliveryById = Effect.fn("EmailOutboxRepository.findDeliveryById")(
    function* (id: string) {
      const row = yield* db.query.emailDeliveryTable.findFirst({
        where: { id },
      });
      return row
        ? yield* decodeEmailDelivery(
            // SAFETY: the stored row is the encoded delivery record; the decoder
            // re-validates it before it is used.
            row as Schema.Codec.Encoded<typeof EmailDeliveryRecord>,
            "findDeliveryById.decodeDelivery"
          )
        : undefined;
    }
  );

  const markIntentState = Effect.fn("EmailOutboxRepository.markIntentState")(
    function* ({
      id,
      state,
    }: {
      readonly id: string;
      readonly state: "materialized" | "paused_by_plan" | "failed" | "expired";
    }) {
      const updatedAt = yield* DateTime.nowAsDate;
      const rows = yield* db
        .update(schema.emailOutboxTable)
        .set({ state, updatedAt })
        .where(
          and(
            eq(schema.emailOutboxTable.id, id),
            state === "expired" || state === "failed"
              ? inArray(schema.emailOutboxTable.state, [
                  "pending",
                  "paused_by_plan",
                ])
              : eq(schema.emailOutboxTable.state, "pending")
          )
        )
        .returning({ id: schema.emailOutboxTable.id });
      return rows.length === 1;
    }
  );

  const resumePausedIntent = Effect.fn(
    "EmailOutboxRepository.resumePausedIntent"
  )(function* ({ id }: { readonly id: string }) {
    const updatedAt = yield* DateTime.nowAsDate;
    const rows = yield* db
      .update(schema.emailOutboxTable)
      .set({
        state: "pending",
        updatedAt,
      })
      .where(
        and(
          eq(schema.emailOutboxTable.id, id),
          eq(schema.emailOutboxTable.state, "paused_by_plan")
        )
      )
      .returning({ id: schema.emailOutboxTable.id });
    return rows.length === 1;
  });

  const resumePausedDeliveries = Effect.fn(
    "EmailOutboxRepository.resumePausedDeliveries"
  )(function* ({
    now,
    organizationId,
  }: {
    readonly now: Date;
    readonly organizationId: string;
  }) {
    const resumableIds = db
      .select({ id: schema.emailDeliveryTable.id })
      .from(schema.emailDeliveryTable)
      .innerJoin(
        schema.emailOutboxTable,
        eq(schema.emailOutboxTable.id, schema.emailDeliveryTable.outboxId)
      )
      .where(
        and(
          eq(schema.emailDeliveryTable.state, "paused_by_plan"),
          eq(schema.emailOutboxTable.organizationId, organizationId),
          or(
            isNull(schema.emailOutboxTable.expiresAt),
            gte(schema.emailOutboxTable.expiresAt, now)
          )
        )
      );
    const resumed = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "queued",
        nextAttemptAt: null,
        transitionVersion: nextTransitionVersion,
        updatedAt: now,
      })
      .where(
        and(
          inArray(schema.emailDeliveryTable.id, resumableIds),
          eq(schema.emailDeliveryTable.state, "paused_by_plan")
        )
      )
      // The caller re-offers each row, so it needs the persisted attempt count
      // and the version this resume just produced for the queue element id.
      .returning({
        attemptCount: schema.emailDeliveryTable.attemptCount,
        id: schema.emailDeliveryTable.id,
        transitionVersion: schema.emailDeliveryTable.transitionVersion,
      });
    return resumed;
  });

  const expirePausedDeliveries = Effect.fn(
    "EmailOutboxRepository.expirePausedDeliveries"
  )(function* ({ now }: { readonly now: Date }) {
    const expirableIds = db
      .select({ id: schema.emailDeliveryTable.id })
      .from(schema.emailDeliveryTable)
      .innerJoin(
        schema.emailOutboxTable,
        eq(schema.emailOutboxTable.id, schema.emailDeliveryTable.outboxId)
      )
      .where(
        and(
          eq(schema.emailDeliveryTable.state, "paused_by_plan"),
          lte(schema.emailOutboxTable.expiresAt, now)
        )
      );
    const expired = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "expired",
        transitionVersion: nextTransitionVersion,
        updatedAt: now,
      })
      .where(
        and(
          inArray(schema.emailDeliveryTable.id, expirableIds),
          eq(schema.emailDeliveryTable.state, "paused_by_plan")
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });
    return expired.map((row) => row.id);
  });

  const createDelivery = Effect.fn("EmailOutboxRepository.createDelivery")(
    function* (input: CreateEmailDeliveryInput) {
      const recipientEmail = yield* normalizeRecipientEmail(
        input.recipientEmail
      );
      const id = yield* EmailDeliveryId.generate;
      const [inserted] = yield* db
        .insert(schema.emailDeliveryTable)
        .values({
          id,
          outboxId: input.outboxId,
          contactId: input.contactId ?? null,
          recipientEmail,
          template: input.template,
          templateVersion: input.templateVersion,
          templatePayload: input.templatePayload,
          messageId: emailDeliveryMessageId(input.outboxId, recipientEmail),
          state: "queued",
          attemptCount: 0,
          nextAttemptAt: null,
          acceptedAt: null,
          deliveredAt: null,
          lastError: null,
          providerMetadata: null,
        })
        .onConflictDoNothing({
          target: [
            schema.emailDeliveryTable.outboxId,
            schema.emailDeliveryTable.recipientEmail,
          ],
        })
        .returning();

      if (!inserted) {
        return { _tag: "Duplicate" as const };
      }

      yield* recordEmailDeliveryTransition("queued");

      return {
        _tag: "Inserted" as const,
        delivery: yield* decodeEmailDelivery(
          inserted,
          "createDelivery.decodeResult"
        ),
      };
    }
  );

  const findDueDeliveries = Effect.fn(
    "EmailOutboxRepository.findDueDeliveries"
  )(function* ({
    before,
    limit = 100,
    staleSendingBefore,
  }: FindDueEmailDeliveriesInput) {
    const rows = yield* db
      .select()
      .from(schema.emailDeliveryTable)
      .where(
        or(
          and(
            inArray(schema.emailDeliveryTable.state, ["queued", "deferred"]),
            or(
              lte(schema.emailDeliveryTable.nextAttemptAt, before),
              isNull(schema.emailDeliveryTable.nextAttemptAt)
            )
          ),
          and(
            eq(schema.emailDeliveryTable.state, "sending"),
            lte(schema.emailDeliveryTable.updatedAt, staleSendingBefore)
          )
        )
      )
      .orderBy(schema.emailDeliveryTable.createdAt)
      .limit(limit);
    return yield* Effect.forEach(rows, (row) =>
      decodeEmailDelivery(
        // SAFETY: the stored row is the encoded delivery record; the decoder
        // re-validates it before it is used.
        row as Schema.Codec.Encoded<typeof EmailDeliveryRecord>,
        "findDueDeliveries.decodeDelivery"
      )
    );
  });

  const claimDeliveryForSending = Effect.fn(
    "EmailOutboxRepository.claimDeliveryForSending"
  )(function* ({ id, now }: { readonly id: string; readonly now: Date }) {
    const claimed = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "sending",
        attemptCount: sql`${schema.emailDeliveryTable.attemptCount} + 1`,
        nextAttemptAt: null,
        transitionVersion: nextTransitionVersion,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          inArray(
            schema.emailDeliveryTable.state,
            deliverySourceStatesFor("sending")
          )
        )
      )
      .returning({
        transitionVersion: schema.emailDeliveryTable.transitionVersion,
      });

    yield* recordEmailDeliveryTransition("sending", claimed.length);

    // The caller needs the version this claim wrote so a later deferral can
    // prove the row still belongs to this attempt.
    return claimed[0]?.transitionVersion;
  });

  const recoverStaleSendingDeliveries = Effect.fn(
    "EmailOutboxRepository.recoverStaleSendingDeliveries"
  )(function* ({ before }: { readonly before: Date }) {
    const updatedAt = yield* DateTime.nowAsDate;
    const rows = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "deferred",
        nextAttemptAt: updatedAt,
        transitionVersion: nextTransitionVersion,
        updatedAt,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.state, "sending"),
          lte(schema.emailDeliveryTable.updatedAt, before)
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });
    yield* recordEmailDeliveryTransition("deferred", rows.length);
    yield* recordEmailReconciliationRecoveries(rows.length);
    return rows.map((row) => row.id);
  });

  const deferSendingDelivery = Effect.fn(
    "EmailOutboxRepository.deferSendingDelivery"
  )(function* ({
    id,
    expectedTransitionVersion,
    nextAttemptAt,
    lastError,
  }: {
    readonly id: string;
    readonly expectedTransitionVersion: number;
    readonly nextAttemptAt: Date;
    readonly lastError: unknown;
  }) {
    const updatedAt = yield* DateTime.nowAsDate;
    const rows = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "deferred",
        nextAttemptAt,
        lastError,
        transitionVersion: nextTransitionVersion,
        updatedAt,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          // Only the attempt that observed this version may schedule the
          // retry; a stale attempt must not overwrite a newer claim or
          // deferral.
          eq(
            schema.emailDeliveryTable.transitionVersion,
            expectedTransitionVersion
          ),
          // A deferral can arrive before the claim (an untyped read failure),
          // so accept every due state rather than only `sending`.
          inArray(schema.emailDeliveryTable.state, [
            "queued",
            "deferred",
            "sending",
          ])
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });
    yield* recordEmailDeliveryTransition("deferred", rows.length);
    // Zero rows means another transition owns the row now; the caller must
    // treat this attempt as stale rather than as the one that scheduled the
    // retry.
    return rows.length === 1;
  });

  const deferDeliveryForThrottle = Effect.fn(
    "EmailOutboxRepository.deferDeliveryForThrottle"
  )(function* ({
    id,
    nextAttemptAt,
    reason,
  }: {
    readonly id: string;
    readonly nextAttemptAt: Date;
    readonly reason: string;
  }) {
    const updatedAt = yield* DateTime.nowAsDate;
    const rows = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "deferred",
        nextAttemptAt,
        lastError: { tag: "EmailDeliveryThrottle", reason },
        transitionVersion: nextTransitionVersion,
        updatedAt,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          inArray(schema.emailDeliveryTable.state, ["queued", "deferred"])
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });
    yield* recordEmailDeliveryTransition("deferred", rows.length);
    return rows.length === 1;
  });

  const markDeliveryAccepted = Effect.fn(
    "EmailOutboxRepository.markDeliveryAccepted"
  )(function* ({
    id,
    acceptedAt,
    providerMetadata,
  }: {
    readonly id: string;
    readonly acceptedAt: Date;
    readonly providerMetadata: unknown;
  }) {
    const rows = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "accepted",
        acceptedAt,
        providerMetadata,
        transitionVersion: nextTransitionVersion,
        updatedAt: acceptedAt,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          eq(schema.emailDeliveryTable.state, "sending")
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });
    yield* recordEmailDeliveryTransition("accepted", rows.length);
    return rows.length === 1;
  });

  const markDeliveryOutcome = Effect.fn(
    "EmailOutboxRepository.markDeliveryOutcome"
  )(function* ({
    id,
    state,
    lastError,
  }: {
    readonly id: string;
    readonly state:
      | "failed"
      | "suppressed"
      | "expired"
      | "paused_by_plan"
      | "no_organization_access";
    readonly lastError?: unknown;
  }) {
    const updatedAt = yield* DateTime.nowAsDate;
    const rows = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state,
        ...(lastError === undefined ? undefined : { lastError }),
        transitionVersion: nextTransitionVersion,
        updatedAt,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          inArray(
            schema.emailDeliveryTable.state,
            deliverySourceStatesFor(state)
          )
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });
    yield* recordEmailDeliveryTransition(state, rows.length);
    return rows.length === 1;
  });

  const markDeliveryDelivered = Effect.fn(
    "EmailOutboxRepository.markDeliveryDelivered"
  )(function* ({
    id,
    deliveredAt,
  }: {
    readonly id: string;
    readonly deliveredAt: Date;
  }) {
    const delivered = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "delivered",
        deliveredAt,
        transitionVersion: nextTransitionVersion,
        updatedAt: deliveredAt,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          inArray(
            schema.emailDeliveryTable.state,
            deliverySourceStatesFor("delivered")
          )
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });

    yield* recordEmailDeliveryTransition("delivered", delivered.length);

    return delivered.length === 1;
  });

  return {
    recordIntent,
    upsertPendingStatusChange,
    upsertPendingSubmissionWindow,
    findPending,
    findPausedByPlan,
    findById,
    findByIdForUpdate,
    findDeliveryById,
    markIntentState,
    resumePausedIntent,
    resumePausedDeliveries,
    expirePausedDeliveries,
    createDelivery,
    findDueDeliveries,
    recoverStaleSendingDeliveries,
    deferSendingDelivery,
    deferDeliveryForThrottle,
    claimDeliveryForSending,
    markDeliveryAccepted,
    markDeliveryOutcome,
    markDeliveryDelivered,
  };
});

export class EmailOutboxRepository extends Context.Service<EmailOutboxRepository>()(
  "EmailOutboxRepository",
  {
    make: makeEmailOutboxRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
