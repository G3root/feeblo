ALTER TABLE "post" ADD COLUMN "eta_quarter" text;--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "role" SET DEFAULT 'manager';--> statement-breakpoint
ALTER TABLE "company_attribute_definition" ALTER COLUMN "type" SET DATA TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "source" SET DATA TYPE text USING "source"::text;--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "source" SET DEFAULT 'DASHBOARD';--> statement-breakpoint
ALTER TABLE "contact_attribute_definition" ALTER COLUMN "type" SET DATA TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "source" SET DATA TYPE text USING "source"::text;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "source" SET DEFAULT 'DASHBOARD';--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "kind" SET DATA TYPE text USING "kind"::text;--> statement-breakpoint
ALTER TABLE "post_activity" ALTER COLUMN "kind" SET DATA TYPE text USING "kind"::text;--> statement-breakpoint
ALTER TABLE "post_status" ALTER COLUMN "type" SET DATA TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "post" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "post" ALTER COLUMN "source" SET DATA TYPE text USING "source"::text;--> statement-breakpoint
ALTER TABLE "post" ALTER COLUMN "source" SET DEFAULT 'DASHBOARD';--> statement-breakpoint
ALTER TABLE "roadmap" ALTER COLUMN "mode" SET DATA TYPE text USING "mode"::text;--> statement-breakpoint
ALTER TABLE "tag" ALTER COLUMN "type" SET DATA TYPE text USING "type"::text;--> statement-breakpoint
DROP INDEX "asset_owner_kind_singleton_uidx";--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "kind" SET DATA TYPE text USING "kind"::text;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_owner_kind_singleton_uidx" ON "asset" (COALESCE("user_id", "organization_id"),"kind") WHERE "kind" IN ('profile_image', 'organization_logo');--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_eta_quarter_format_chk" CHECK ("eta_quarter" is null or "eta_quarter" ~ '^[0-9]{4}-Q[1-4]$');--> statement-breakpoint
DROP TYPE "attribute_data_type";--> statement-breakpoint
DROP TYPE "contact_company_source";--> statement-breakpoint
DROP TYPE "notification_kind";--> statement-breakpoint
DROP TYPE "post_activity_kind";--> statement-breakpoint
DROP TYPE "post_icon_type";--> statement-breakpoint
DROP TYPE "post_source";--> statement-breakpoint
DROP TYPE "post_status_types";--> statement-breakpoint
DROP TYPE "roadmap_mode";--> statement-breakpoint
DROP TYPE "tag_type";--> statement-breakpoint
DROP TYPE "asset_kind";