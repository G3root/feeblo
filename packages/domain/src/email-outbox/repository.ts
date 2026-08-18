import { createHash } from "node:crypto";

import { Database, schema } from "@feeblo/db";
import { EmailDeliveryId, EmailOutboxId } from "@feeblo/id";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  type EmailAddress,
  parseEmailAddress,
} from "../email-subscription/schema";
import { deliverySourceStatesFor } from "./delivery-state";
import {
  type EmailDeliveryRecord as EmailDelivery,
  EmailDeliveryRecord,
  type EmailOutboxRecord as EmailIntent,
  EmailIntentPayload,
  EmailOutboxRecord,
  type EmailIntentPayload as IntentPayload,
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

const dataError = (operation: string, reason: string): EmailOutboxDataError =>
  new EmailOutboxDataError({ operation, reason });

const decodeIntentPayload = (
  input: Schema.Codec.Encoded<typeof EmailIntentPayload>,
  operation: string
): Effect.Effect<IntentPayload, EmailOutboxDataError> =>
  Schema.decodeUnknownEffect(EmailIntentPayload)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email intent payload is invalid")
    )
  );

const decodeEmailIntent = (
  input: Schema.Codec.Encoded<typeof EmailOutboxRecord>,
  operation: string
): Effect.Effect<EmailIntent, EmailOutboxDataError> =>
  Effect.gen(function* () {
    const intent = yield* Schema.decodeUnknownEffect(EmailOutboxRecord)(
      input
    ).pipe(
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
  Schema.decodeUnknownEffect(EmailDeliveryRecord)(input).pipe(
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
        updatedAt: now,
      })
      .where(
        and(
          inArray(schema.emailDeliveryTable.id, resumableIds),
          eq(schema.emailDeliveryTable.state, "paused_by_plan")
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });
    return resumed.map((row) => row.id);
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
      .returning({ id: schema.emailDeliveryTable.id });

    yield* recordEmailDeliveryTransition("sending", claimed.length);

    return claimed.length === 1;
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
    nextAttemptAt,
    lastError,
  }: {
    readonly id: string;
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
        updatedAt,
      })
      .where(
        and(
          eq(schema.emailDeliveryTable.id, id),
          eq(schema.emailDeliveryTable.state, "sending")
        )
      )
      .returning({ id: schema.emailDeliveryTable.id });
    yield* recordEmailDeliveryTransition("deferred", rows.length);
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
    readonly state: "failed" | "suppressed" | "expired" | "paused_by_plan";
    readonly lastError?: unknown;
  }) {
    const updatedAt = yield* DateTime.nowAsDate;
    const rows = yield* db
      .update(schema.emailDeliveryTable)
      .set({
        state,
        ...(lastError === undefined ? undefined : { lastError }),
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
