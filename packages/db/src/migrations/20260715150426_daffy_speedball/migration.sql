ALTER TABLE "company_attribute_value" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_attribute_value" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
CREATE INDEX "company_attribute_value_organizationId_idx" ON "company_attribute_value" ("organization_id");--> statement-breakpoint
CREATE INDEX "contact_attribute_value_organizationId_idx" ON "contact_attribute_value" ("organization_id");--> statement-breakpoint
ALTER TABLE "company_attribute_value" ADD CONSTRAINT "company_attribute_value_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_attribute_value" ADD CONSTRAINT "contact_attribute_value_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;