CREATE TABLE "subscription_revocation" (
	"external_subscription_id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "subscription_revocation_organizationId_idx" ON "subscription_revocation" ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_organizationId_idx" ON "subscription" ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_productId_idx" ON "subscription" ("product_id");