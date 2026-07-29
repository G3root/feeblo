CREATE TABLE "feedback_ingestion_outbox" (
	"receipt_id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_ingestion_outbox_pending_idx" ON "feedback_ingestion_outbox" ("scheduled_at","created_at");--> statement-breakpoint
ALTER TABLE "feedback_ingestion_outbox" ADD CONSTRAINT "feedback_ingestion_outbox_receipt_id_feedback_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "feedback_receipt"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_ingestion_outbox" ADD CONSTRAINT "feedback_ingestion_outbox_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_ingestion_outbox" ADD CONSTRAINT "feedback_ingestion_outbox_receipt_same_organization_fk" FOREIGN KEY ("receipt_id","organization_id") REFERENCES "feedback_receipt"("id","organization_id") ON DELETE CASCADE;