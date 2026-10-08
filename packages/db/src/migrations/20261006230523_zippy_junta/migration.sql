DROP INDEX "post_status_organizationId_type_uidx";--> statement-breakpoint
ALTER TABLE "post_status" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "post_status_organizationId_default_uidx" ON "post_status" ("organization_id") WHERE "is_default";
