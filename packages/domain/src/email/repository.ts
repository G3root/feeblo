import { currentDb, schema, transaction } from "@feeblo/db";
import type { PostStatusChangedEmailPayload } from "@feeblo/db/validation-schema/email-event-payload";
import { EmailDeliveryId, EmailEventId } from "@feeblo/id";
import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";
import { EmailConfig } from "./config";
import { digestWindowKey, formatStatusLabel, postUrl } from "./payload";
import { PostStatusChangedEmailWorkflow } from "./workflow";

export type EmailDeliveryStatus =
  (typeof schema.emailDeliveryStatusEnum.enumValues)[number];

export type EmailEventRow = {
  attempts: number;
  dedupeKey: string;
  id: string;
  organizationId: string;
  payload: PostStatusChangedEmailPayload;
};

type TEnqueuePostStatusChanged = {
  actorMemberId: string | null;
  actorUserId: string | null;
  nextStatusId: string;
  organizationId: string;
  postId: string;
  previousStatusId: string;
};

const makeEmailEventRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const config = yield* EmailConfig;

  /**
   * Appends a status change to the coalescing outbox row for this post +
   * window, or inserts a fresh row. Runs inside the caller's transaction
   * (fiber-local connection) — no outbox write, no mutation commit.
   *
   * The payload snapshot (post title, URL, status labels) is written once at
   * enqueue time so later edits or deletes cannot corrupt delivery. Returns
   * the event id; `inserted: true` means the caller should schedule a
   * workflow (re-scheduling an existing event is also safe — execution ids
   * dedupe on event id).
   */
  const enqueuePostStatusChanged = (input: TEnqueuePostStatusChanged) =>
    Effect.gen(function* () {
      const post = yield* db
        .select({
          boardSlug: schema.boardTable.slug,
          slug: schema.postTable.slug,
          title: schema.postTable.title,
        })
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .where(
          and(
            eq(schema.postTable.id, input.postId),
            eq(schema.postTable.organizationId, input.organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]));

      if (!post) {
        return null;
      }

      const statuses = yield* db
        .select({
          id: schema.postStatusTable.id,
          type: schema.postStatusTable.type,
        })
        .from(schema.postStatusTable)
        .where(
          inArray(schema.postStatusTable.id, [
            input.previousStatusId,
            input.nextStatusId,
          ])
        );

      const typeById = new Map(
        statuses.map((status) => [status.id, status.type])
      );
      const previousType = typeById.get(input.previousStatusId) ?? "UNKNOWN";
      const nextType = typeById.get(input.nextStatusId) ?? "UNKNOWN";

      const payload: PostStatusChangedEmailPayload = {
        kind: "post_status_changed",
        organizationId: input.organizationId,
        postId: input.postId,
        postTitle: post.title,
        postUrl: postUrl(input.organizationId, post.boardSlug, post.slug),
        actorMemberId: input.actorMemberId,
        actorUserId: input.actorUserId,
        changes: [
          {
            previousStatusType: previousType,
            previousStatusLabel: formatStatusLabel(previousType),
            nextStatusType: nextType,
            nextStatusLabel: formatStatusLabel(nextType),
          },
        ],
      };

      const now = new Date();
      const dedupeKey = digestWindowKey(input.postId, now, config.digestWindow);
      const eventId = yield* EmailEventId.generate;

      // Coalesce: when a pending event already exists for this post + window,
      // append this change to its payload instead of creating a new event.
      // The `where` guard means a sent/failed/processing event is never
      // resurrected — the conflict falls through to a fresh row below.
      const merged = yield* db
        .insert(schema.emailEventTable)
        .values({
          id: eventId,
          kind: "post_status_changed",
          organizationId: input.organizationId,
          payload,
          dedupeKey,
        })
        .onConflictDoUpdate({
          target: schema.emailEventTable.dedupeKey,
          set: {
            payload: sql`${schema.emailEventTable.payload} || jsonb_build_object('changes', coalesce(${schema.emailEventTable.payload}->'changes', '[]'::jsonb) || jsonb_build_array(${payload}::jsonb))`,
            availableAt: now,
          },
          where: eq(schema.emailEventTable.status, "pending"),
        })
        .returning({ id: schema.emailEventTable.id });

      const mergedEvent = merged[0];
      if (mergedEvent !== undefined) {
        return { eventId: mergedEvent.id, inserted: false };
      }

      // Conflict with a non-pending event (already delivered) — this change
      // deserves its own event in the same window.
      const freshId = yield* EmailEventId.generate;
      yield* db
        .insert(schema.emailEventTable)
        .values({
          id: freshId,
          kind: "post_status_changed",
          organizationId: input.organizationId,
          payload,
          dedupeKey: `${dedupeKey}:${freshId}`,
          availableAt: now,
        })
        .pipe(Effect.asVoid);

      return { eventId: freshId, inserted: true };
    });

  /**
   * Best-effort workflow scheduling after the mutation transaction commits.
   * Mirrors `PostRepository.scheduleSubmissionNotification`: failures are
   * logged, never surfaced — the durable event row stays pending and is
   * drained by the next schedule call or the periodic reaper.
   */
  const scheduleEvent = (eventId: string, organizationId: string) =>
    Effect.gen(function* () {
      const engineOption = yield* Effect.serviceOption(WorkflowEngine);

      if (Option.isNone(engineOption)) {
        return;
      }

      const row = yield* findById(eventId);
      if (!row || row.organizationId !== organizationId) {
        return;
      }

      // Execution ids derive from the event id, so repeated schedules
      // collapse onto one execution (the engine dedupes).
      yield* PostStatusChangedEmailWorkflow.execute(
        { eventId, organizationId },
        { discard: true }
      ).pipe(Effect.provideService(WorkflowEngine, engineOption.value));
    });

  const findById = (eventId: string) =>
    db
      .select({
        attempts: schema.emailEventTable.attempts,
        dedupeKey: schema.emailEventTable.dedupeKey,
        id: schema.emailEventTable.id,
        organizationId: schema.emailEventTable.organizationId,
        payload: schema.emailEventTable.payload,
      })
      .from(schema.emailEventTable)
      .where(eq(schema.emailEventTable.id, eventId))
      .limit(1)
      .pipe(Effect.map((rows) => (rows[0] ?? null) as EmailEventRow | null));

  /** Claim the event for processing (idempotent across activity retries). */
  const claim = (eventId: string) =>
    Effect.gen(function* () {
      const now = new Date();
      const rows = yield* db
        .update(schema.emailEventTable)
        .set({
          attempts: sql`${schema.emailEventTable.attempts} + 1`,
          lastError: null,
          processedAt: now,
          status: "processing",
        })
        .where(
          and(
            eq(schema.emailEventTable.id, eventId),
            inArray(schema.emailEventTable.status, ["pending", "processing"]),
            lte(schema.emailEventTable.availableAt, now)
          )
        )
        .returning({ id: schema.emailEventTable.id });
      return rows.length > 0;
    });

  /** Recipients: post creator + subscribers, deduped by email, actor excluded. */
  const resolveRecipients = ({
    actorUserId,
    organizationId,
    postId,
  }: {
    actorUserId: string | null;
    organizationId: string;
    postId: string;
  }) =>
    Effect.gen(function* () {
      const subscribers = yield* db
        .select({
          email: schema.userTable.email,
          memberId: schema.postSubscriptionTable.memberId,
          userId: schema.postSubscriptionTable.userId,
        })
        .from(schema.postSubscriptionTable)
        .innerJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postSubscriptionTable.userId)
        )
        .where(
          and(
            eq(schema.postSubscriptionTable.organizationId, organizationId),
            eq(schema.postSubscriptionTable.postId, postId)
          )
        );

      const creator = yield* db
        .select({
          creatorMemberId: schema.postTable.creatorMemberId,
          creatorUserId: schema.postTable.creatorId,
          email: schema.userTable.email,
        })
        .from(schema.postTable)
        .innerJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .where(
          and(
            eq(schema.postTable.id, postId),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]));

      const byEmail = new Map<
        string,
        {
          email: string;
          memberId: string | null;
          userId: string | null;
        }
      >();

      for (const subscriber of subscribers) {
        if (subscriber.email && subscriber.userId) {
          byEmail.set(subscriber.email.toLowerCase(), {
            email: subscriber.email,
            memberId: subscriber.memberId,
            userId: subscriber.userId,
          });
        }
      }

      if (creator?.email && creator.creatorUserId) {
        byEmail.set(creator.email.toLowerCase(), {
          email: creator.email,
          memberId: creator.creatorMemberId,
          userId: creator.creatorUserId,
        });
      }

      return [...byEmail.values()].filter(
        (recipient) => recipient.userId !== actorUserId
      );
    });

  const findSuppressed = (emails: readonly string[]) =>
    emails.length === 0
      ? Effect.succeed(new Set<string>())
      : db
          .select({ email: schema.suppressedEmailTable.email })
          .from(schema.suppressedEmailTable)
          .where(
            inArray(
              schema.suppressedEmailTable.email,
              emails.map((email) => email.toLowerCase())
            )
          )
          .pipe(Effect.map((rows) => new Set(rows.map((row) => row.email))));

  /** Emails sent to this recipient in the last 24 hours (daily cap check). */
  const sentCountSince = (email: string, since: Date) =>
    db
      .select({ value: count() })
      .from(schema.emailDeliveryTable)
      .where(
        and(
          eq(schema.emailDeliveryTable.recipient, email.toLowerCase()),
          eq(schema.emailDeliveryTable.status, "sent"),
          gte(schema.emailDeliveryTable.sentAt, since)
        )
      )
      .pipe(Effect.map((rows) => rows[0]?.value ?? 0));

  /** True when this recipient already has a `sent` delivery for this event. */
  const hasSentDelivery = (eventId: string, email: string) =>
    db
      .select({ id: schema.emailDeliveryTable.id })
      .from(schema.emailDeliveryTable)
      .where(
        and(
          eq(schema.emailDeliveryTable.eventId, eventId),
          eq(schema.emailDeliveryTable.recipient, email.toLowerCase()),
          eq(schema.emailDeliveryTable.status, "sent")
        )
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows.length > 0));

  type TUpsertDelivery = {
    error?: string | null;
    eventId: string;
    memberId?: string | null;
    organizationId: string;
    providerMessageId?: string | null;
    recipient: string;
    status: EmailDeliveryStatus;
    template: string;
  };

  /** Insert-or-update the per-recipient delivery record. */
  const upsertDelivery = (input: TUpsertDelivery) =>
    Effect.gen(function* () {
      const id = yield* EmailDeliveryId.generate;
      const sentAt = input.status === "sent" ? new Date() : null;
      yield* db
        .insert(schema.emailDeliveryTable)
        .values({
          id,
          eventId: input.eventId,
          organizationId: input.organizationId,
          memberId: input.memberId ?? null,
          recipient: input.recipient.toLowerCase(),
          template: input.template,
          status: input.status,
          providerMessageId: input.providerMessageId ?? null,
          sentAt,
          error: input.error ?? null,
        })
        .onConflictDoUpdate({
          target: [
            schema.emailDeliveryTable.eventId,
            schema.emailDeliveryTable.recipient,
          ],
          set: {
            status: input.status,
            providerMessageId: input.providerMessageId ?? null,
            sentAt,
            error: input.error ?? null,
            attempts: sql`${schema.emailDeliveryTable.attempts} + 1`,
          },
        })
        .pipe(Effect.asVoid);
    });

  /** Terminal transition: delivered, or a dead letter when `failed`. */
  const complete = (
    eventId: string,
    status: "sent" | "failed",
    error?: string
  ) =>
    db
      .update(schema.emailEventTable)
      .set({
        lastError: error ?? null,
        processedAt: new Date(),
        status,
      })
      .where(eq(schema.emailEventTable.id, eventId))
      .pipe(Effect.asVoid);

  /**
   * Recycle: mark the parent event failed and create a fresh event row with
   * the same self-contained payload. Each event id maps to exactly one
   * workflow execution, so any re-attempt (cap hold, post-retry) must get a
   * fresh row to get a fresh execution — execution ids dedupe on event ids.
   */
  const recycle = (
    parent: EmailEventRow,
    options: { availableAt: Date; error: string; nextEventId: string }
  ) =>
    transaction(
      Effect.gen(function* () {
        yield* complete(parent.id, "failed", options.error);
        yield* db
          .insert(schema.emailEventTable)
          .values({
            id: options.nextEventId,
            kind: parent.payload.kind,
            organizationId: parent.organizationId,
            payload: parent.payload,
            dedupeKey: `${parent.dedupeKey}:${options.nextEventId}`,
            status: "pending",
            attempts: parent.attempts,
            availableAt: options.availableAt,
          })
          .pipe(Effect.asVoid);
      })
    );

  /** Reaper scan: pending events whose `available_at` has passed. */
  const findDueEvents = (limit: number) => {
    const now = new Date();
    return db
      .select({
        id: schema.emailEventTable.id,
        organizationId: schema.emailEventTable.organizationId,
      })
      .from(schema.emailEventTable)
      .where(
        and(
          eq(schema.emailEventTable.status, "pending"),
          lte(schema.emailEventTable.availableAt, now)
        )
      )
      .orderBy(schema.emailEventTable.availableAt)
      .limit(limit);
  };

  // -- Admin / observability -------------------------------------------------

  const listSuppressed = () =>
    db
      .select({
        email: schema.suppressedEmailTable.email,
        reason: schema.suppressedEmailTable.reason,
        createdAt: schema.suppressedEmailTable.createdAt,
      })
      .from(schema.suppressedEmailTable)
      .orderBy(sql`${schema.suppressedEmailTable.createdAt} desc`);

  const deleteSuppressed = (email: string) =>
    db
      .delete(schema.suppressedEmailTable)
      .where(eq(schema.suppressedEmailTable.email, email.toLowerCase()))
      .pipe(Effect.map((rows) => rows.length > 0));

  /** Dead letters: events that exhausted their attempts. */
  const listDeadLetters = (organizationId: string) =>
    db
      .select({
        id: schema.emailEventTable.id,
        kind: schema.emailEventTable.kind,
        attempts: schema.emailEventTable.attempts,
        lastError: schema.emailEventTable.lastError,
        availableAt: schema.emailEventTable.availableAt,
        createdAt: schema.emailEventTable.createdAt,
      })
      .from(schema.emailEventTable)
      .where(
        and(
          eq(schema.emailEventTable.organizationId, organizationId),
          eq(schema.emailEventTable.status, "failed")
        )
      )
      .orderBy(sql`${schema.emailEventTable.createdAt} desc`)
      .limit(100);

  const deliveryStats = (organizationId: string) =>
    Effect.gen(function* () {
      const byStatus = yield* db
        .select({
          status: schema.emailDeliveryTable.status,
          value: count(),
        })
        .from(schema.emailDeliveryTable)
        .where(eq(schema.emailDeliveryTable.organizationId, organizationId))
        .groupBy(schema.emailDeliveryTable.status);

      const byTemplate = yield* db
        .select({
          template: schema.emailDeliveryTable.template,
          value: count(),
        })
        .from(schema.emailDeliveryTable)
        .where(eq(schema.emailDeliveryTable.organizationId, organizationId))
        .groupBy(schema.emailDeliveryTable.template);

      const statusCounts = { sent: 0, failed: 0, skipped: 0, suppressed: 0 };
      for (const row of byStatus) {
        statusCounts[row.status] = row.value;
      }

      const templateCounts: Record<string, number> = {};
      for (const row of byTemplate) {
        templateCounts[row.template] = row.value;
      }

      return { byStatus: statusCounts, byTemplate: templateCounts };
    });

  return {
    claim,
    complete,
    deliveryStats,
    deleteSuppressed,
    enqueuePostStatusChanged,
    findById,
    findDueEvents,
    findSuppressed,
    hasSentDelivery,
    isOverMaxAttempts: (attempts: number) => attempts >= config.maxAttempts,
    listDeadLetters,
    listSuppressed,
    recycle,
    resolveRecipients,
    scheduleEvent,
    sentCountSince,
    upsertDelivery,
  } as const;
});

export class EmailEventRepository extends Context.Service<EmailEventRepository>()(
  "EmailEventRepository",
  { make: makeEmailEventRepository.pipe(Effect.provide(EmailConfig.layer)) }
) {
  static readonly layer = Layer.effect(this, this.make);
}
