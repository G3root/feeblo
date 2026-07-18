CREATE TYPE "contact_company_source" AS ENUM('DASHBOARD', 'WIDGET', 'API', 'IMPORT');--> statement-breakpoint
CREATE TABLE "submission_notification_batch" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_notification_queue" (
	"post_id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "source" "contact_company_source" DEFAULT 'DASHBOARD'::"contact_company_source" NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "source" "contact_company_source" DEFAULT 'DASHBOARD'::"contact_company_source" NOT NULL;--> statement-breakpoint
CREATE INDEX "submission_notification_queue_organization_idx" ON "submission_notification_queue" ("organization_id");--> statement-breakpoint
ALTER TABLE "submission_notification_batch" ADD CONSTRAINT "submission_notification_batch_kCxPdJxLS9cJ_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "submission_notification_queue" ADD CONSTRAINT "submission_notification_queue_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "submission_notification_queue" ADD CONSTRAINT "submission_notification_queue_54LYiNshYitK_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;