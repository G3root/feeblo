CREATE TABLE "data_import_job" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"board_id" text NOT NULL,
	"created_by_user_id" text,
	"created_by_member_id" text,
	"status" text NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"notices" jsonb DEFAULT '[]' NOT NULL,
	"row_count" integer NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"failure_message" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_import_job_counts_check" CHECK ("row_count" >= 0 AND "created_count" >= 0 AND "warning_count" >= 0 AND "error_count" >= 0),
	CONSTRAINT "data_import_job_lease_check" CHECK (("status" = 'running') = ("lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "data_import_row" (
	"id" text PRIMARY KEY,
	"job_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"message" text,
	"payload" jsonb,
	"post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_import_row_row_number_check" CHECK ("row_number" > 0),
	CONSTRAINT "data_import_row_payload_check" CHECK ("outcome" <> 'created' OR "post_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "data_import_job_claim_idx" ON "data_import_job" ("status","created_at");--> statement-breakpoint
CREATE INDEX "data_import_job_organization_created_idx" ON "data_import_job" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "data_import_job_organization_file_hash_idx" ON "data_import_job" ("organization_id","file_hash");--> statement-breakpoint
CREATE INDEX "data_import_job_retention_idx" ON "data_import_job" ("retention_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_import_row_job_row_uidx" ON "data_import_row" ("job_id","row_number");--> statement-breakpoint
CREATE INDEX "data_import_row_job_outcome_row_idx" ON "data_import_row" ("job_id","outcome","row_number");--> statement-breakpoint
ALTER TABLE "data_import_job" ADD CONSTRAINT "data_import_job_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "data_import_job" ADD CONSTRAINT "data_import_job_board_id_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "data_import_job" ADD CONSTRAINT "data_import_job_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "data_import_job" ADD CONSTRAINT "data_import_job_created_by_member_id_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "data_import_row" ADD CONSTRAINT "data_import_row_job_id_data_import_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "data_import_job"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "data_import_row" ADD CONSTRAINT "data_import_row_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE SET NULL;