CREATE TABLE "external_resource_create_request" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"post_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text NOT NULL,
	"external_resource_id" text,
	"post_external_resource_link_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installation" (
	"connection_id" text PRIMARY KEY,
	"installation_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_sync_rule" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"issue_match_mode" text NOT NULL,
	"issue_state" text NOT NULL,
	"post_status_id" text NOT NULL,
	"upvoter_notification_policy" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_webhook_delivery" (
	"id" text PRIMARY KEY,
	"connection_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event_name" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_external_resource" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"remote_id" text NOT NULL,
	"remote_url" text NOT NULL,
	"display_key" text,
	"title" text,
	"state_key" text,
	"safe_metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_external_resource_link" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"post_id" text NOT NULL,
	"external_resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "post_status_organizationId_id_uidx" ON "post_status" ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_resource_create_request_connection_key_uidx" ON "external_resource_create_request" ("connection_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "github_installation_installation_id_uidx" ON "github_installation" ("installation_id");--> statement-breakpoint
CREATE INDEX "github_installation_account_idx" ON "github_installation" ("account_id");--> statement-breakpoint
CREATE INDEX "github_sync_rule_connection_enabled_idx" ON "github_sync_rule" ("connection_id","enabled");--> statement-breakpoint
CREATE INDEX "github_sync_rule_organization_idx" ON "github_sync_rule" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_webhook_delivery_connection_delivery_uidx" ON "github_webhook_delivery" ("connection_id","delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_external_resource_organization_id_uidx" ON "integration_external_resource" ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_external_resource_connection_type_remote_uidx" ON "integration_external_resource" ("connection_id","resource_type","remote_id");--> statement-breakpoint
CREATE INDEX "integration_external_resource_organization_connection_idx" ON "integration_external_resource" ("organization_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_external_resource_link_organization_id_uidx" ON "post_external_resource_link" ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_external_resource_link_post_resource_uidx" ON "post_external_resource_link" ("post_id","external_resource_id");--> statement-breakpoint
CREATE INDEX "post_external_resource_link_organization_post_idx" ON "post_external_resource_link" ("organization_id","post_id");--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_eU77wOAyFsGn_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_organization_connection_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "integration_connection"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_post_organization_fkey" FOREIGN KEY ("post_id","organization_id") REFERENCES "post"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_organization_resource_fkey" FOREIGN KEY ("organization_id","external_resource_id") REFERENCES "integration_external_resource"("organization_id","id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "external_resource_create_request" ADD CONSTRAINT "external_resource_create_request_organization_link_fkey" FOREIGN KEY ("organization_id","post_external_resource_link_id") REFERENCES "post_external_resource_link"("organization_id","id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_hxjCxRRkLkaP_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "github_sync_rule" ADD CONSTRAINT "github_sync_rule_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "github_sync_rule" ADD CONSTRAINT "github_sync_rule_organization_connection_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "integration_connection"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "github_sync_rule" ADD CONSTRAINT "github_sync_rule_organization_status_fkey" FOREIGN KEY ("organization_id","post_status_id") REFERENCES "post_status"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "github_webhook_delivery" ADD CONSTRAINT "github_webhook_delivery_XC1Ae9VBXiU3_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_external_resource" ADD CONSTRAINT "integration_external_resource_DDcoUtAHSqcr_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_external_resource" ADD CONSTRAINT "integration_external_resource_organization_connection_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "integration_connection"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_external_resource_link" ADD CONSTRAINT "post_external_resource_link_ywAvLx23F2Vs_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_external_resource_link" ADD CONSTRAINT "post_external_resource_link_post_organization_fkey" FOREIGN KEY ("post_id","organization_id") REFERENCES "post"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_external_resource_link" ADD CONSTRAINT "post_external_resource_link_organization_resource_fkey" FOREIGN KEY ("organization_id","external_resource_id") REFERENCES "integration_external_resource"("organization_id","id") ON DELETE CASCADE;