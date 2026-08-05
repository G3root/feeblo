-- Evolving vocabularies move from Postgres enums to plain text columns.
-- Values are validated at the domain boundary (Effect Schemas in
-- @feeblo/db/validation-schema/*); the column types are derived from them via
-- $type<T...>(), so new values don't require migrations.
--
-- Unique indexes that include the enum columns are dropped first because
-- Postgres cannot rebuild an enum-typed index expression during ALTER TYPE;
-- they are recreated verbatim afterwards. Columns with enum-typed defaults
-- (post/contact/company.source) get their defaults reset to plain text.
DROP INDEX IF EXISTS "post_status_organizationId_type_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "tag_organizationId_type_name_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "tag_organizationId_type_slug_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "asset_owner_kind_singleton_uidx";--> statement-breakpoint
ALTER TABLE "post_activity" ALTER COLUMN "kind" TYPE text USING "kind"::text;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "kind" TYPE text USING "kind"::text;--> statement-breakpoint
ALTER TABLE "tag" ALTER COLUMN "type" TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "contact_attribute_definition" ALTER COLUMN "type" TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "company_attribute_definition" ALTER COLUMN "type" TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "post_status" ALTER COLUMN "type" TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "kind" TYPE text USING "kind"::text;--> statement-breakpoint
ALTER TABLE "roadmap" ALTER COLUMN "mode" TYPE text USING "mode"::text;--> statement-breakpoint
ALTER TABLE "post" ALTER COLUMN "source" TYPE text USING "source"::text;--> statement-breakpoint
ALTER TABLE "post" ALTER COLUMN "source" SET DEFAULT 'DASHBOARD';--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "source" TYPE text USING "source"::text;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "source" SET DEFAULT 'DASHBOARD';--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "source" TYPE text USING "source"::text;--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "source" SET DEFAULT 'DASHBOARD';--> statement-breakpoint
DROP TYPE "post_activity_kind";--> statement-breakpoint
DROP TYPE "notification_kind";--> statement-breakpoint
DROP TYPE "tag_type";--> statement-breakpoint
DROP TYPE "attribute_data_type";--> statement-breakpoint
DROP TYPE "post_status_types";--> statement-breakpoint
DROP TYPE "asset_kind";--> statement-breakpoint
DROP TYPE "roadmap_mode";--> statement-breakpoint
DROP TYPE "post_icon_type";--> statement-breakpoint
DROP TYPE "post_source";--> statement-breakpoint
DROP TYPE "contact_company_source";--> statement-breakpoint
CREATE UNIQUE INDEX "post_status_organizationId_type_uidx" ON "post_status" USING btree ("organization_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_organizationId_type_name_uidx" ON "tag" USING btree ("organization_id","type","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_organizationId_type_slug_uidx" ON "tag" USING btree ("organization_id","type","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_owner_kind_singleton_uidx" ON "asset" (COALESCE("user_id", "organization_id"),"kind") WHERE "kind" IN ('profile_image', 'organization_logo');
