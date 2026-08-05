CREATE TYPE "asset_kind" AS ENUM('profile_image', 'organization_logo', 'editor_image', 'editor_video');--> statement-breakpoint
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
CREATE TABLE "changelog_asset" (
	"changelog_id" text,
	"asset_id" text,
	CONSTRAINT "changelog_asset_pkey" PRIMARY KEY("changelog_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "post_asset" (
	"post_id" text,
	"asset_id" text,
	CONSTRAINT "post_asset_pkey" PRIMARY KEY("post_id","asset_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "asset_key_uidx" ON "asset" ("bucket","key");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_owner_kind_singleton_uidx" ON "asset" (COALESCE("user_id", "organization_id"),"kind") WHERE "kind" IN ('profile_image', 'organization_logo');--> statement-breakpoint
CREATE INDEX "asset_userId_idx" ON "asset" ("user_id");--> statement-breakpoint
CREATE INDEX "asset_organizationId_idx" ON "asset" ("organization_id");--> statement-breakpoint
CREATE INDEX "asset_url_idx" ON "asset" ("url");--> statement-breakpoint
CREATE INDEX "changelog_asset_assetId_idx" ON "changelog_asset" ("asset_id");--> statement-breakpoint
CREATE INDEX "post_asset_assetId_idx" ON "post_asset" ("asset_id");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_asset" ADD CONSTRAINT "changelog_asset_changelog_id_changelog_id_fkey" FOREIGN KEY ("changelog_id") REFERENCES "changelog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_asset" ADD CONSTRAINT "changelog_asset_asset_id_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_asset" ADD CONSTRAINT "post_asset_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_asset" ADD CONSTRAINT "post_asset_asset_id_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE;