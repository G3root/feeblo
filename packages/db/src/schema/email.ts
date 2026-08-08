import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { TEmailDeliveryStatus } from "../validation-schema/email-delivery-status";
import type { TEmailEventKind } from "../validation-schema/email-event-kind";
import type { EmailEventPayload } from "../validation-schema/email-event-payload";
import type { TEmailEventStatus } from "../validation-schema/email-event-status";
import type { TEmailSuppressionReason } from "../validation-schema/email-suppression-reason";
import { memberTable, organizationTable } from "./auth";

/**
 * Transactional outbox: one row per email-worthy event, written in the same
 * database transaction as the source mutation. The payload is self-contained
 * (snapshot of the post/status context) so later edits or deletes cannot
 * corrupt delivery; recipients are resolved fresh at send time.
 *
 * `dedupeKey` is the coalescing/claim lock: concurrent enqueues for the same
 * post inside the same digest window collapse onto one row (see
 * `EmailEventRepository.enqueuePostStatusChanged`).
 *
 * Status/kind columns are plain text typed from Effect Schema vocabulary
 * (`../validation-schema/*`) — the same pattern as `notification.kind` — so
 * new states and kinds never require a migration.
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
    status: text("status")
      .$type<TEmailEventStatus>()
      .default("pending")
      .notNull(),
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
 *
 * `bouncedAt`/`complainedAt` are stamped by the webhook ingestion endpoint
 * when the provider reports a hard bounce or complaint for the message.
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
    status: text("status").$type<TEmailDeliveryStatus>().notNull(),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").default(0).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
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

/**
 * Emails that must never be sent again (hard bounce / complaint / manual).
 * Reason is plain text typed from Effect Schema vocabulary.
 */
export const suppressedEmailTable = pgTable("suppressed_email", {
  email: text("email").primaryKey(),
  reason: text("reason").$type<TEmailSuppressionReason>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
