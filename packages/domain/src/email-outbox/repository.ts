import { createHash } from "node:crypto";
import { Database, schema } from "@feeblo/db";
import { EmailDeliveryId, EmailOutboxId } from "@feeblo/id";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { canTransitionDelivery } from "./delivery-state";
import {
  EmailDeliveryRecord,
  EmailIntentPayload,
  EmailOutboxRecord,
  type EmailDeliveryRecord as EmailDelivery,
  type EmailIntentKind,
  type EmailIntentPayload as IntentPayload,
  type EmailOutboxRecord as EmailIntent,
} from "./schema";
import {
  recordEmailDeliveryTransition,
  recordEmailIntentTransition,
  recordEmailReconciliationRecoveries,
} from "./telemetry";

export class EmailOutboxDataError extends Schema.TaggedErrorClass<EmailOutboxDataError>()(
  "EmailOutboxDataError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export interface RecordEmailIntentInput {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly deduplicationKey: string;
  readonly expiresAt: Date | null;
  readonly kind: EmailIntentKind;
  readonly organizationId: string;
  readonly payload: IntentPayload;
  readonly scheduledAt: Date;
}

export interface RecordStatusChangeIntentInput {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly deduplicationKey: string;
  readonly expiresAt: Date | null;
  readonly organizationId: string;
  readonly payload: Extract<
    IntentPayload,
    { readonly kind: "post.status_changed" }
  >;
  readonly scheduledAt: Date;
}

export interface CreateEmailDeliveryInput {
  readonly contactId?: string | null;
  readonly outboxId: string;
  readonly recipientEmail: string;
  readonly template: string;
  readonly templatePayload: unknown;
  readonly templateVersion: number;
}

export interface FindPendingEmailIntentsInput {
  readonly before: Date;
  readonly organizationId?: string;
}

export interface FindDueEmailDeliveriesInput {
  readonly before: Date;
  readonly staleSendingBefore: Date;
}

const dataError = (operation: string, reason: string): EmailOutboxDataError =>
  new EmailOutboxDataError({ operation, reason });

const decodeIntentPayload = (
  input: unknown,
  operation: string
): Effect.Effect<IntentPayload, EmailOutboxDataError> =>
  Schema.decodeUnknownEffect(EmailIntentPayload)(input).pipe(
    Effect.mapError(() => dataError(operation, "Stored email intent payload is invalid"))
  );

const decodeEmailIntent = (
  input: unknown,
  operation: string
): Effect.Effect<EmailIntent, EmailOutboxDataError> =>
  Effect.gen(function* () {
    const intent = yield* Schema.decodeUnknownEffect(EmailOutboxRecord)(input).pipe(
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
  input: unknown,
  operation: string
): Effect.Effect<EmailDelivery, EmailOutboxDataError> =>
  Schema.decodeUnknownEffect(EmailDeliveryRecord)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email delivery record is invalid")
    )
  );

const normalizeRecipientEmail = (
  recipientEmail: string
): Effect.Effect<string, EmailOutboxDataError> => {
  const normalized = recipientEmail.trim().toLowerCase();
  return normalized.length > 0
    ? Effect.succeed(normalized)
    : Effect.fail(dataError("createDelivery", "Recipient email is empty"));
};

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

  const recordIntent = Effect.fn("EmailOutboxRepository.recordIntent")(
    function* (input: RecordEmailIntentInput) {
      const payload = yield* decodeIntentPayload(
        input.payload,
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
        intent: yield* decodeEmailIntent(inserted, "recordIntent.decodeResult"),
      };
    }
  );

  const upsertPendingStatusChange = Effect.fn(
    "EmailOutboxRepository.upsertPendingStatusChange"
  )(function* (input: RecordStatusChangeIntentInput) {
    const payload = yield* decodeIntentPayload(
      input.payload,
      "upsertPendingStatusChange.decodePayload"
    );
    if (payload.kind !== "post.status_changed") {
      return yield* dataError(
        "upsertPendingStatusChange.decodePayload",
        "Status coalescing only accepts post.status_changed payloads"
      );
    }

    const id = yield* EmailOutboxId.generate;
    const [written] = yield* db
      .insert(schema.emailOutboxTable)
      .values({
        id,
        organizationId: input.organizationId,
        kind: "post.status_changed",
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        deduplicationKey: input.deduplicationKey,
        payload,
        scheduledAt: input.scheduledAt,
        expiresAt: input.expiresAt,
        state: "pending",
      })
      .onConflictDoUpdate({
        target: [
          schema.emailOutboxTable.organizationId,
          schema.emailOutboxTable.kind,
          schema.emailOutboxTable.aggregateId,
        ],
        targetWhere: sql`${schema.emailOutboxTable.state} = 'pending' AND ${schema.emailOutboxTable.kind} = 'post.status_changed'`,
        set: {
          payload,
          updatedAt: new Date(),
        },
      })
      .returning();

    return written
      ? {
          _tag: "Written" as const,
          intent: yield* decodeEmailIntent(
            written,
            "upsertPendingStatusChange.decodeResult"
          ),
        }
      : { _tag: "AlreadyMaterialized" as const };
  });

  const findPending = Effect.fn("EmailOutboxRepository.findPending")(
    function* ({ before, organizationId }: FindPendingEmailIntentsInput) {
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
        .orderBy(schema.emailOutboxTable.scheduledAt);

      return yield* Effect.forEach(rows, (row) =>
        decodeEmailIntent(row, "findPending.decodeIntent")
      );
    }
  );

  const findPausedByPlan = Effect.fn("EmailOutboxRepository.findPausedByPlan")(
    function* ({ before }: { readonly before: Date }) {
      const rows = yield* db.select().from(schema.emailOutboxTable).where(and(
        eq(schema.emailOutboxTable.state, "paused_by_plan"),
        lte(schema.emailOutboxTable.scheduledAt, before),
      ));
      return yield* Effect.forEach(rows, (row) =>
        decodeEmailIntent(row, "findPausedByPlan.decodeIntent")
      );
    }
  );

  const findById = Effect.fn("EmailOutboxRepository.findById")(
    function* (id: string) {
      const row = yield* db.query.emailOutboxTable.findFirst({ where: { id } });
      return row
        ? yield* decodeEmailIntent(row, "findById.decodeIntent")
        : undefined;
    }
  );

  const findDeliveryById = Effect.fn("EmailOutboxRepository.findDeliveryById")(
    function* (id: string) {
      const row = yield* db.query.emailDeliveryTable.findFirst({ where: { id } });
      return row
        ? yield* decodeEmailDelivery(row, "findDeliveryById.decodeDelivery")
        : undefined;
    }
  );

  const markIntentState = Effect.fn("EmailOutboxRepository.markIntentState")(
    function* ({ id, state }: { readonly id: string; readonly state: "materialized" | "paused_by_plan" | "expired" }) {
      const rows = yield* db.update(schema.emailOutboxTable).set({ state, updatedAt: new Date() })
        .where(and(
          eq(schema.emailOutboxTable.id, id),
          state === "expired"
            ? inArray(schema.emailOutboxTable.state, ["pending", "paused_by_plan"])
            : eq(schema.emailOutboxTable.state, "pending")
        ))
        .returning({ id: schema.emailOutboxTable.id });
      return rows.length === 1;
    }
  );

  const resumePausedIntent = Effect.fn("EmailOutboxRepository.resumePausedIntent")(
    function* ({ id }: { readonly id: string }) {
      const rows = yield* db.update(schema.emailOutboxTable).set({
        state: "pending",
        updatedAt: new Date(),
      }).where(and(
        eq(schema.emailOutboxTable.id, id),
        eq(schema.emailOutboxTable.state, "paused_by_plan"),
      )).returning({ id: schema.emailOutboxTable.id });
      return rows.length === 1;
    }
  );

  const resumePausedDeliveries = Effect.fn("EmailOutboxRepository.resumePausedDeliveries")(
    function* ({ now, organizationId }: { readonly now: Date; readonly organizationId: string }) {
      const rows = yield* db.select({ id: schema.emailDeliveryTable.id })
        .from(schema.emailDeliveryTable)
        .innerJoin(schema.emailOutboxTable, eq(schema.emailOutboxTable.id, schema.emailDeliveryTable.outboxId))
        .where(and(
          eq(schema.emailDeliveryTable.state, "paused_by_plan"),
          eq(schema.emailOutboxTable.organizationId, organizationId),
          or(isNull(schema.emailOutboxTable.expiresAt), gte(schema.emailOutboxTable.expiresAt, now)),
        ));
      const resumed = yield* Effect.forEach(rows, (row) => db.update(schema.emailDeliveryTable).set({
        state: "queued", nextAttemptAt: null, updatedAt: now,
      }).where(and(
        eq(schema.emailDeliveryTable.id, row.id),
        eq(schema.emailDeliveryTable.state, "paused_by_plan"),
      )).returning({ id: schema.emailDeliveryTable.id }));
      return resumed.flatMap((row) => row.map((value) => value.id));
    }
  );

  const expirePausedDeliveries = Effect.fn("EmailOutboxRepository.expirePausedDeliveries")(
    function* ({ now }: { readonly now: Date }) {
      const rows = yield* db.select({ id: schema.emailDeliveryTable.id })
        .from(schema.emailDeliveryTable)
        .innerJoin(schema.emailOutboxTable, eq(schema.emailOutboxTable.id, schema.emailDeliveryTable.outboxId))
        .where(and(
          eq(schema.emailDeliveryTable.state, "paused_by_plan"),
          lte(schema.emailOutboxTable.expiresAt, now)
        ));
      const expired = yield* Effect.forEach(rows, (row) => db.update(schema.emailDeliveryTable).set({
        state: "expired", updatedAt: now,
      }).where(and(
        eq(schema.emailDeliveryTable.id, row.id),
        eq(schema.emailDeliveryTable.state, "paused_by_plan")
      )).returning({ id: schema.emailDeliveryTable.id }));
      return expired.flatMap((result) => result.map((row) => row.id));
    }
  );

  const createDelivery = Effect.fn("EmailOutboxRepository.createDelivery")(
    function* (input: CreateEmailDeliveryInput) {
      const recipientEmail = yield* normalizeRecipientEmail(input.recipientEmail);
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

  const findDueDeliveries = Effect.fn("EmailOutboxRepository.findDueDeliveries")(
    function* ({ before, staleSendingBefore }: FindDueEmailDeliveriesInput) {
      const rows = yield* db.select().from(schema.emailDeliveryTable).where(
        or(
          and(
            inArray(schema.emailDeliveryTable.state, ["queued", "deferred"]),
            or(
              lte(schema.emailDeliveryTable.nextAttemptAt, before),
              sql`${schema.emailDeliveryTable.nextAttemptAt} IS NULL`
            )
          ),
          and(
            eq(schema.emailDeliveryTable.state, "sending"),
            lte(schema.emailDeliveryTable.updatedAt, staleSendingBefore)
          )
        )
      );
      return yield* Effect.forEach(rows, (row) =>
        decodeEmailDelivery(row, "findDueDeliveries.decodeDelivery")
      );
    }
  );

  const claimDeliveryForSending = Effect.fn(
    "EmailOutboxRepository.claimDeliveryForSending"
  )(function* ({ id, now }: { readonly id: string; readonly now: Date }) {
    if (!canTransitionDelivery("queued", "sending")) {
      return false;
    }

    const claimed = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "sending",
        attemptCount: sql`${schema.emailDeliveryTable.attemptCount} + 1`,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          inArray(schema.emailDeliveryTable.state, ["queued", "deferred"])
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });

    yield* recordEmailDeliveryTransition("sending", claimed.length);

    return claimed.length === 1;
  });

  const recoverStaleSendingDeliveries = Effect.fn(
    "EmailOutboxRepository.recoverStaleSendingDeliveries"
  )(function* ({ before }: { readonly before: Date }) {
    const rows = yield* db.update(schema.emailDeliveryTable).set({
      state: "deferred",
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(schema.emailDeliveryTable.state, "sending"),
      lte(schema.emailDeliveryTable.updatedAt, before)
    )).returning({ id: schema.emailDeliveryTable.id });
    yield* recordEmailDeliveryTransition("deferred", rows.length);
    yield* recordEmailReconciliationRecoveries(rows.length);
    return rows.map((row) => row.id);
  });

  const releaseSendingDelivery = Effect.fn(
    "EmailOutboxRepository.releaseSendingDelivery"
  )(function* ({ id, nextAttemptAt, lastError }: {
    readonly id: string;
    readonly nextAttemptAt: Date;
    readonly lastError: unknown;
  }) {
    const rows = yield* db.update(schema.emailDeliveryTable).set({
      state: "deferred",
      nextAttemptAt,
      lastError,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.emailDeliveryTable.id, id),
      eq(schema.emailDeliveryTable.state, "sending")
    )).returning({ id: schema.emailDeliveryTable.id });
    yield* recordEmailDeliveryTransition("deferred", rows.length);
    return rows.length === 1;
  });

  const markDeliveryAccepted = Effect.fn("EmailOutboxRepository.markDeliveryAccepted")(
    function* ({ id, acceptedAt, providerMetadata }: { readonly id: string; readonly acceptedAt: Date; readonly providerMetadata: unknown }) {
      const rows = yield* db.update(schema.emailDeliveryTable).set({
        state: "accepted", acceptedAt, providerMetadata, updatedAt: acceptedAt,
      }).where(and(eq(schema.emailDeliveryTable.id, id), eq(schema.emailDeliveryTable.state, "sending"))).returning({ id: schema.emailDeliveryTable.id });
      yield* recordEmailDeliveryTransition("accepted", rows.length);
      return rows.length === 1;
    }
  );

  const markDeliveryDeferred = Effect.fn("EmailOutboxRepository.markDeliveryDeferred")(
    function* ({ id, nextAttemptAt, lastError }: { readonly id: string; readonly nextAttemptAt: Date; readonly lastError: unknown }) {
      const rows = yield* db.update(schema.emailDeliveryTable).set({
        state: "deferred", nextAttemptAt, lastError, updatedAt: new Date(),
      }).where(and(eq(schema.emailDeliveryTable.id, id), eq(schema.emailDeliveryTable.state, "sending"))).returning({ id: schema.emailDeliveryTable.id });
      yield* recordEmailDeliveryTransition("deferred", rows.length);
      return rows.length === 1;
    }
  );

  const markDeliveryTerminal = Effect.fn("EmailOutboxRepository.markDeliveryTerminal")(
    function* ({ id, state, lastError }: { readonly id: string; readonly state: "failed" | "suppressed" | "expired" | "paused_by_plan"; readonly lastError?: unknown }) {
      const rows = yield* db.update(schema.emailDeliveryTable).set({
        state, ...(lastError === undefined ? {} : { lastError }), updatedAt: new Date(),
      }).where(and(eq(schema.emailDeliveryTable.id, id), inArray(schema.emailDeliveryTable.state, ["queued", "deferred", "sending"]))).returning({ id: schema.emailDeliveryTable.id });
      yield* recordEmailDeliveryTransition(state, rows.length);
      return rows.length === 1;
    }
  );

  const markDeliveryDelivered = Effect.fn(
    "EmailOutboxRepository.markDeliveryDelivered"
  )(function* ({ id, deliveredAt }: { readonly id: string; readonly deliveredAt: Date }) {
    if (!canTransitionDelivery("sending", "delivered")) {
      return false;
    }

    const delivered = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state: "delivered",
        deliveredAt,
        updatedAt: deliveredAt,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          inArray(schema.emailDeliveryTable.state, ["sending", "accepted"])
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });

    yield* recordEmailDeliveryTransition("delivered", delivered.length);

    return delivered.length === 1;
  });

  return {
    recordIntent,
    upsertPendingStatusChange,
    findPending,
    findPausedByPlan,
    findById,
    findDeliveryById,
    markIntentState,
    resumePausedIntent,
    resumePausedDeliveries,
    expirePausedDeliveries,
    createDelivery,
    findDueDeliveries,
    recoverStaleSendingDeliveries,
    releaseSendingDelivery,
    claimDeliveryForSending,
    markDeliveryAccepted,
    markDeliveryDeferred,
    markDeliveryTerminal,
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
