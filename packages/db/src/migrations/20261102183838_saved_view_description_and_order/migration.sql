ALTER TABLE "saved_view" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "order_index" integer DEFAULT 0 NOT NULL;