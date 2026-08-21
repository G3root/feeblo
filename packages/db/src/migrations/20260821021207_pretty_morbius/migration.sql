ALTER TABLE "post_activity" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_email_trgm_idx" ON "contact" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_name_trgm_idx" ON "contact" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_name_trgm_idx" ON "company" USING gin ("name" gin_trgm_ops);