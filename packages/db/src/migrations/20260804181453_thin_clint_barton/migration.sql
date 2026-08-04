ALTER TABLE "changelog" ADD COLUMN "cover_image" text;--> statement-breakpoint
ALTER TABLE "changelog" ADD COLUMN "excerpt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "metadata" jsonb DEFAULT '{}' NOT NULL;