CREATE TYPE "email_delivery_status" AS ENUM('sent', 'skipped', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "email_event_status" AS ENUM('pending', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "email_suppression_reason" AS ENUM('hard_bounce', 'complaint', 'manual');--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" text PRIMARY KEY,
	"event_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text,
	"recipient" text NOT NULL,
	"template" text NOT NULL,
	"status" "email_delivery_status" NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_event" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"organization_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "email_event_status" DEFAULT 'pending'::"email_event_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "suppressed_email" (
	"email" text PRIMARY KEY,
	"reason" "email_suppression_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_eventId_recipient_uidx" ON "email_delivery" ("event_id","recipient");--> statement-breakpoint
CREATE INDEX "email_delivery_organizationId_idx" ON "email_delivery" ("organization_id");--> statement-breakpoint
CREATE INDEX "email_delivery_recipient_idx" ON "email_delivery" ("recipient");--> statement-breakpoint
CREATE UNIQUE INDEX "email_event_dedupeKey_uidx" ON "email_event" ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_event_status_availableAt_idx" ON "email_event" ("status","available_at");--> statement-breakpoint
CREATE INDEX "email_event_organizationId_idx" ON "email_event" ("organization_id");--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_event_id_email_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "email_event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_member_id_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_event" ADD CONSTRAINT "email_event_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;