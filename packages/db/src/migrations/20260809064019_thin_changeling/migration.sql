CREATE INDEX "email_delivery_contactId_idx" ON "email_delivery" ("contact_id");--> statement-breakpoint
CREATE INDEX "email_subscription_recipientLookup_idx" ON "email_subscription" ("organization_id","topic_type","topic_id","state","contact_id");--> statement-breakpoint
CREATE INDEX "email_subscription_state_organizationId_idx" ON "email_subscription" ("state","organization_id");