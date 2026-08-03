CREATE TYPE "asset_kind" AS ENUM('profile_image', 'organization_logo', 'editor_image', 'editor_video');--> statement-breakpoint
CREATE TABLE "asset_deletion" (
	"id" text PRIMARY KEY,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text PRIMARY KEY,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"url" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"user_id" text,
	"organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_owner_check" CHECK (("user_id" IS NOT NULL) <> ("organization_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "asset_deletion_bucket_key_uidx" ON "asset_deletion" ("bucket","key");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_key_uidx" ON "asset" ("bucket","key");--> statement-breakpoint
CREATE INDEX "asset_userId_idx" ON "asset" ("user_id");--> statement-breakpoint
CREATE INDEX "asset_organizationId_idx" ON "asset" ("organization_id");--> statement-breakpoint
CREATE INDEX "asset_url_idx" ON "asset" ("url");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;