import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { TEmailEventKind } from "../validation-schema/email-event-kind";
import type { EmailEventPayload } from "../validation-schema/email-event-payload";
import { memberTable, organizationTable } from "./auth";

export const emailEventStatusEnum = pgEnum("email_event_status", [
  "pending",
  "processing",
  "sent",
  "failed",
]);

export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "sent",
  "skipped",
  "failed",
  "suppressed",
]);

export const emailSuppressionReasonEnum = pgEnum("email_suppression_reason", [
  "hard_bounce",
  "complaint",
  "manual",
]);

/**
 * Transactional outbox: one row per email-worthy event, written in the same
 * database transaction as the source mutation. The payload is self-contained
 * (snapshot of the post/status context) so later edits or deletes cannot
 * corrupt delivery; recipients are resolved fresh at send time.
 *
 * `dedupeKey` is the coalescing/claim lock: concurrent enqueues for the same
 * post inside the same digest window collapse onto one row (see
 * `EmailEventRepository.enqueuePostStatusChanged`).
 */
export const emailEventTable = pgTable(
  "email_event",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<TEmailEventKind>().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<EmailEventPayload>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: emailEventStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("email_event_dedupeKey_uidx").on(table.dedupeKey),
    index("email_event_status_availableAt_idx").on(
      table.status,
      table.availableAt
    ),
    index("email_event_organizationId_idx").on(table.organizationId),
  ]
);

/**
 * Per-recipient delivery record: the answer to "did member X get the email
 * about post Y?". The unique `(eventId, recipient)` pair is also the
 * crash-restart guard — a resumed activity never re-sends a recipient that
 * already has a `sent` row.
 */
export const emailDeliveryTable = pgTable(
  "email_delivery",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => emailEventTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => memberTable.id, {
      onDelete: "set null",
    }),
    recipient: text("recipient").notNull(),
    template: text("template").notNull(),
    status: emailDeliveryStatusEnum("status").notNull(),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").default(0).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_delivery_eventId_recipient_uidx").on(
      table.eventId,
      table.recipient
    ),
    index("email_delivery_organizationId_idx").on(table.organizationId),
    index("email_delivery_recipient_idx").on(table.recipient),
  ]
);

/** Emails that must never be sent again (hard bounce / complaint / manual). */
export const suppressedEmailTable = pgTable("suppressed_email", {
  email: text("email").primaryKey(),
  reason: emailSuppressionReasonEnum("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
