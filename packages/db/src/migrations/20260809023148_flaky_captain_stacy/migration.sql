CREATE TABLE "email_contact" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"verification_state" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" text PRIMARY KEY,
	"outbox_id" text NOT NULL,
	"contact_id" text,
	"recipient_email" text NOT NULL,
	"template" text NOT NULL,
	"template_version" integer NOT NULL,
	"template_payload" jsonb NOT NULL,
	"message_id" text NOT NULL,
	"state" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" jsonb,
	"provider_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_subscription" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"topic_type" text NOT NULL,
	"topic_id" text,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"verification_token_hash" text,
	"verification_expires_at" timestamp with time zone,
	"unsubscribe_token_hash" text,
	"verified_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_subscription_contactId_topicType_topicId_uidx" UNIQUE NULLS NOT DISTINCT("contact_id","topic_type","topic_id")
);
--> statement-breakpoint
CREATE TABLE "email_suppression" (
	"email" text PRIMARY KEY,
	"reason" text NOT NULL,
	"provider_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_contact_organizationId_email_uidx" ON "email_contact" ("organization_id","email");--> statement-breakpoint
CREATE INDEX "email_contact_userId_idx" ON "email_contact" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_outboxId_recipientEmail_uidx" ON "email_delivery" ("outbox_id","recipient_email");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_messageId_uidx" ON "email_delivery" ("message_id");--> statement-breakpoint
CREATE INDEX "email_delivery_state_nextAttemptAt_idx" ON "email_delivery" ("state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_organizationId_deduplicationKey_uidx" ON "email_outbox" ("organization_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "email_outbox_state_scheduledAt_idx" ON "email_outbox" ("state","scheduled_at");--> statement-breakpoint
CREATE INDEX "email_outbox_organizationId_state_idx" ON "email_outbox" ("organization_id","state");--> statement-breakpoint
CREATE INDEX "email_subscription_organizationId_state_idx" ON "email_subscription" ("organization_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppression_providerEventId_uidx" ON "email_suppression" ("provider_event_id");--> statement-breakpoint
ALTER TABLE "email_contact" ADD CONSTRAINT "email_contact_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_contact" ADD CONSTRAINT "email_contact_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_outbox_id_email_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "email_outbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_contact_id_email_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "email_contact"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_subscription" ADD CONSTRAINT "email_subscription_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_subscription" ADD CONSTRAINT "email_subscription_contact_id_email_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "email_contact"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE TABLE "email_provider_event" (
	"provider_event_id" text PRIMARY KEY,
	"delivery_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_provider_event_deliveryId_occurredAt_idx" ON "email_provider_event" ("delivery_id","occurred_at");--> statement-breakpoint
ALTER TABLE "email_provider_event" ADD CONSTRAINT "email_provider_event_delivery_id_email_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "email_delivery"("id") ON DELETE CASCADE;
