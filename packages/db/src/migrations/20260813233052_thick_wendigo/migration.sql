ALTER TABLE "external_resource_create_request" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "external_resource_create_request" AS request
SET "organization_id" = connection."organization_id"
FROM "integration_connection" AS connection
WHERE request."connection_id" = connection."id";--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "post_status_organizationId_id_uidx" ON "post_status" ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_external_resource_organization_id_uidx" ON "integration_external_resource" ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_external_resource_link_organization_id_uidx" ON "post_external_resource_link" ("organization_id","id");--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_eU77wOAyFsGn_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_organization_connection_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "integration_connection"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_post_organization_fkey" FOREIGN KEY ("post_id","organization_id") REFERENCES "post"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_organization_resource_fkey" FOREIGN KEY ("organization_id","external_resource_id") REFERENCES "integration_external_resource"("organization_id","id");--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_organization_link_fkey" FOREIGN KEY ("organization_id","post_external_resource_link_id") REFERENCES "post_external_resource_link"("organization_id","id");--> statement-breakpoint
ALTER TABLE "github_sync_rule" ADD CONSTRAINT "github_sync_rule_organization_connection_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "integration_connection"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "github_sync_rule" ADD CONSTRAINT "github_sync_rule_organization_status_fkey" FOREIGN KEY ("organization_id","post_status_id") REFERENCES "post_status"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_external_resource" ADD CONSTRAINT "integration_external_resource_organization_connection_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "integration_connection"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_external_resource_link" ADD CONSTRAINT "post_external_resource_link_post_organization_fkey" FOREIGN KEY ("post_id","organization_id") REFERENCES "post"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_external_resource_link" ADD CONSTRAINT "post_external_resource_link_organization_resource_fkey" FOREIGN KEY ("organization_id","external_resource_id") REFERENCES "integration_external_resource"("organization_id","id") ON DELETE CASCADE;
