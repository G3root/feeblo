ALTER TABLE "post_status" ADD COLUMN "label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_status" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "post_status" ADD COLUMN "icon" text;