DROP TABLE "changelog_tag";--> statement-breakpoint
DROP INDEX "tag_organizationId_type_name_uidx";--> statement-breakpoint
DROP INDEX "tag_organizationId_type_slug_uidx";--> statement-breakpoint
DELETE FROM "tag" WHERE "type" = 'CHANGELOG';--> statement-breakpoint
ALTER TABLE "tag" DROP COLUMN "type";--> statement-breakpoint
CREATE UNIQUE INDEX "tag_organizationId_name_uidx" ON "tag" ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_organizationId_slug_uidx" ON "tag" ("organization_id","slug");