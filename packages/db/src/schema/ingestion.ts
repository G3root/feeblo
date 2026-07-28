import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { memberTable, organizationTable } from "./auth";
import { boardTable, contactTable, postTable } from "./feedback";

export const feedbackChannelKindEnum = pgEnum("feedback_channel_kind", [
  "WIDGET",
  "PUBLIC_PORTAL",
  "DASHBOARD",
  "API",
  "CSV_IMPORT",
  "SLACK",
  "EMAIL",
]);

export const feedbackPipelineStageEnum = pgEnum("feedback_pipeline_stage", [
  "CAPTURED",
  "IDENTIFIED",
  "READY",
  "FAILED",
]);

export const feedbackTriageActionEnum = pgEnum("feedback_triage_action", [
  "CREATE_POST",
  "LINK_POST",
  "REVIEW",
]);

export const feedbackTriageStatusEnum = pgEnum("feedback_triage_status", [
  "OPEN",
  "POST_CREATED",
  "POST_LINKED",
  "IGNORED",
]);

export const feedbackToneEnum = pgEnum("feedback_tone", [
  "NEGATIVE",
  "NEUTRAL",
  "POSITIVE",
]);

export const feedbackPriorityEnum = pgEnum("feedback_priority", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export type FeedbackSender = {
  readonly upstreamId?: string | undefined;
  readonly email?: string | undefined;
  readonly name?: string | undefined;
};

export type FeedbackMessage = {
  readonly text: string;
  readonly title?: string | undefined;
};

export type FeedbackMetadata = Readonly<Record<string, unknown>>;

export const feedbackChannelTable = pgTable(
  "feedback_channel",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    kind: feedbackChannelKindEnum("kind").notNull(),
    label: text("label").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("feedback_channel_organizationId_key_uidx").on(
      table.organizationId,
      table.key
    ),
    index("feedback_channel_organizationId_kind_idx").on(
      table.organizationId,
      table.kind
    ),
  ]
);

export const feedbackReceiptTable = pgTable(
  "feedback_receipt",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => feedbackChannelTable.id, { onDelete: "cascade" }),
    upstreamItemId: text("upstream_item_id"),
    deliveryKey: text("delivery_key").notNull(),
    sender: jsonb("sender").$type<FeedbackSender>().notNull(),
    message: jsonb("message").$type<FeedbackMessage>().notNull(),
    metadata: jsonb("metadata").$type<FeedbackMetadata>().default({}).notNull(),
    pipelineStage: feedbackPipelineStageEnum("pipeline_stage")
      .default("CAPTURED")
      .notNull(),
    contactId: text("contact_id").references(() => contactTable.id, {
      onDelete: "set null",
    }),
    failureDetail: text("failure_detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "feedback_receipt_organizationId_channelId_deliveryKey_uidx"
    ).on(table.organizationId, table.channelId, table.deliveryKey),
    uniqueIndex("feedback_receipt_id_organizationId_uidx").on(
      table.id,
      table.organizationId
    ),
    index("feedback_receipt_organizationId_pipelineStage_idx").on(
      table.organizationId,
      table.pipelineStage
    ),
    index("feedback_receipt_contactId_idx").on(table.contactId),
  ]
);

export const contactIdentityLinkTable = pgTable(
  "contact_identity_link",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => feedbackChannelTable.id, { onDelete: "cascade" }),
    upstreamContactId: text("upstream_contact_id").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contactTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "contact_identity_link_organizationId_channelId_upstreamContactId_uidx"
    ).on(table.organizationId, table.channelId, table.upstreamContactId),
    index("contact_identity_link_contactId_idx").on(table.contactId),
  ]
);

export const feedbackTriageItemTable = pgTable(
  "feedback_triage_item",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => feedbackReceiptTable.id, { onDelete: "cascade" }),
    action: feedbackTriageActionEnum("action").notNull(),
    status: feedbackTriageStatusEnum("status").default("OPEN").notNull(),
    digest: text("digest").notNull(),
    excerpts: jsonb("excerpts")
      .$type<readonly string[]>()
      .default([])
      .notNull(),
    customerNeed: text("customer_need"),
    tone: feedbackToneEnum("tone"),
    priority: feedbackPriorityEnum("priority"),
    interpretationConfidence: real("interpretation_confidence"),
    proposedTitle: text("proposed_title"),
    proposedBody: text("proposed_body"),
    proposedBoardId: text("proposed_board_id").references(() => boardTable.id, {
      onDelete: "set null",
    }),
    proposedPostId: text("proposed_post_id").references(() => postTable.id, {
      onDelete: "set null",
    }),
    resolvedPostId: text("resolved_post_id").references(() => postTable.id, {
      onDelete: "set null",
    }),
    rationale: text("rationale"),
    decidedByMemberId: text("decided_by_member_id").references(
      () => memberTable.id,
      { onDelete: "set null" }
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("feedback_triage_item_receiptId_uidx").on(table.receiptId),
    index("feedback_triage_item_organizationId_status_createdAt_idx").on(
      table.organizationId,
      table.status,
      table.createdAt
    ),
    check(
      "feedback_triage_item_confidence_range_chk",
      sql`${table.interpretationConfidence} is null or (${table.interpretationConfidence} >= 0 and ${table.interpretationConfidence} <= 1)`
    ),
    check(
      "feedback_triage_item_decision_fields_chk",
      sql`(${table.status} = 'OPEN' and ${table.decidedAt} is null and ${table.decidedByMemberId} is null) or (${table.status} <> 'OPEN' and ${table.decidedAt} is not null)`
    ),
    check(
      "feedback_triage_item_post_result_chk",
      sql`(${table.status} in ('POST_CREATED', 'POST_LINKED') and ${table.resolvedPostId} is not null) or (${table.status} in ('OPEN', 'IGNORED') and ${table.resolvedPostId} is null)`
    ),
    foreignKey({
      name: "feedback_triage_item_receipt_same_organization_fk",
      columns: [table.receiptId, table.organizationId],
      foreignColumns: [
        feedbackReceiptTable.id,
        feedbackReceiptTable.organizationId,
      ],
    }).onDelete("cascade"),
  ]
);
