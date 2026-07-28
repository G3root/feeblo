CREATE TYPE "feedback_channel_kind" AS ENUM('WIDGET', 'PUBLIC_PORTAL', 'DASHBOARD', 'API', 'CSV_IMPORT', 'SLACK', 'EMAIL');--> statement-breakpoint
CREATE TYPE "feedback_pipeline_stage" AS ENUM('CAPTURED', 'IDENTIFIED', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "feedback_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "feedback_tone" AS ENUM('NEGATIVE', 'NEUTRAL', 'POSITIVE');--> statement-breakpoint
CREATE TYPE "feedback_triage_action" AS ENUM('CREATE_POST', 'LINK_POST', 'REVIEW');--> statement-breakpoint
CREATE TYPE "feedback_triage_status" AS ENUM('OPEN', 'POST_CREATED', 'POST_LINKED', 'IGNORED');--> statement-breakpoint
ALTER TYPE "post_activity_kind" ADD VALUE 'FEEDBACK_ATTACHED';--> statement-breakpoint
CREATE TABLE "contact_identity_link" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"upstream_contact_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_channel" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" "feedback_channel_kind" NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_receipt" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"upstream_item_id" text,
	"delivery_key" text NOT NULL,
	"sender" jsonb NOT NULL,
	"message" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"pipeline_stage" "feedback_pipeline_stage" DEFAULT 'CAPTURED'::"feedback_pipeline_stage" NOT NULL,
	"contact_id" text,
	"failure_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_triage_item" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"action" "feedback_triage_action" NOT NULL,
	"status" "feedback_triage_status" DEFAULT 'OPEN'::"feedback_triage_status" NOT NULL,
	"digest" text NOT NULL,
	"excerpts" jsonb DEFAULT '[]' NOT NULL,
	"customer_need" text,
	"tone" "feedback_tone",
	"priority" "feedback_priority",
	"interpretation_confidence" real,
	"proposed_title" text,
	"proposed_body" text,
	"proposed_board_id" text,
	"proposed_post_id" text,
	"resolved_post_id" text,
	"rationale" text,
	"decided_by_member_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_triage_item_confidence_range_chk" CHECK ("interpretation_confidence" is null or ("interpretation_confidence" >= 0 and "interpretation_confidence" <= 1)),
	CONSTRAINT "feedback_triage_item_decision_fields_chk" CHECK (("status" = 'OPEN' and "decided_at" is null and "decided_by_member_id" is null) or ("status" <> 'OPEN' and "decided_at" is not null)),
	CONSTRAINT "feedback_triage_item_post_result_chk" CHECK (("status" in ('POST_CREATED', 'POST_LINKED') and "resolved_post_id" is not null) or ("status" in ('OPEN', 'IGNORED') and "resolved_post_id" is null))
);
--> statement-breakpoint
ALTER TABLE "upvote" ADD COLUMN "contact_id" text;--> statement-breakpoint
ALTER TABLE "upvote" ADD COLUMN "added_by_member_id" text;--> statement-breakpoint
ALTER TABLE "upvote" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "upvote_userId_postId_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "upvote_userId_postId_uidx" ON "upvote" ("user_id","post_id") WHERE "user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "upvote_contactId_postId_uidx" ON "upvote" ("contact_id","post_id") WHERE "contact_id" is not null;--> statement-breakpoint
CREATE INDEX "upvote_contactId_idx" ON "upvote" ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identity_link_organizationId_channelId_upstreamContactId_uidx" ON "contact_identity_link" ("organization_id","channel_id","upstream_contact_id");--> statement-breakpoint
CREATE INDEX "contact_identity_link_contactId_idx" ON "contact_identity_link" ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_channel_organizationId_key_uidx" ON "feedback_channel" ("organization_id","key");--> statement-breakpoint
CREATE INDEX "feedback_channel_organizationId_kind_idx" ON "feedback_channel" ("organization_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_receipt_organizationId_channelId_deliveryKey_uidx" ON "feedback_receipt" ("organization_id","channel_id","delivery_key");--> statement-breakpoint
CREATE INDEX "feedback_receipt_organizationId_pipelineStage_idx" ON "feedback_receipt" ("organization_id","pipeline_stage");--> statement-breakpoint
CREATE INDEX "feedback_receipt_contactId_idx" ON "feedback_receipt" ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_triage_item_receiptId_uidx" ON "feedback_triage_item" ("receipt_id");--> statement-breakpoint
CREATE INDEX "feedback_triage_item_organizationId_status_createdAt_idx" ON "feedback_triage_item" ("organization_id","status","created_at");--> statement-breakpoint
ALTER TABLE "upvote" ADD CONSTRAINT "upvote_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "upvote" ADD CONSTRAINT "upvote_added_by_member_id_member_id_fkey" FOREIGN KEY ("added_by_member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "contact_identity_link" ADD CONSTRAINT "contact_identity_link_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_identity_link" ADD CONSTRAINT "contact_identity_link_channel_id_feedback_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "feedback_channel"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_identity_link" ADD CONSTRAINT "contact_identity_link_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_channel" ADD CONSTRAINT "feedback_channel_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_receipt" ADD CONSTRAINT "feedback_receipt_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_receipt" ADD CONSTRAINT "feedback_receipt_channel_id_feedback_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "feedback_channel"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_receipt" ADD CONSTRAINT "feedback_receipt_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feedback_triage_item" ADD CONSTRAINT "feedback_triage_item_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_triage_item" ADD CONSTRAINT "feedback_triage_item_receipt_id_feedback_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "feedback_receipt"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_triage_item" ADD CONSTRAINT "feedback_triage_item_proposed_board_id_board_id_fkey" FOREIGN KEY ("proposed_board_id") REFERENCES "board"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feedback_triage_item" ADD CONSTRAINT "feedback_triage_item_proposed_post_id_post_id_fkey" FOREIGN KEY ("proposed_post_id") REFERENCES "post"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feedback_triage_item" ADD CONSTRAINT "feedback_triage_item_resolved_post_id_post_id_fkey" FOREIGN KEY ("resolved_post_id") REFERENCES "post"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feedback_triage_item" ADD CONSTRAINT "feedback_triage_item_decided_by_member_id_member_id_fkey" FOREIGN KEY ("decided_by_member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "upvote" ADD CONSTRAINT "upvote_exactly_one_actor_chk" CHECK (("user_id" is not null and "contact_id" is null) or ("user_id" is null and "contact_id" is not null));