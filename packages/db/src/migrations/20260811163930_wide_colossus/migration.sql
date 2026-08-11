CREATE TABLE "integration_connection" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"remote_account_id" text,
	"lifecycle" text NOT NULL,
	"credential_generation" integer DEFAULT 1 NOT NULL,
	"credentials_ciphertext" text,
	"safe_display_metadata" jsonb,
	"consecutive_exhausted_deliveries" integer DEFAULT 0 NOT NULL,
	"last_succeeded_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"retention_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connection_credential_generation_check" CHECK ("credential_generation" > 0),
	CONSTRAINT "integration_connection_exhausted_count_check" CHECK ("consecutive_exhausted_deliveries" >= 0)
);
--> statement-breakpoint
CREATE TABLE "integration_delivery_attempt" (
	"id" text PRIMARY KEY,
	"delivery_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"http_status" integer,
	"error_tag" text,
	"retry_decision" text,
	"diagnostics" jsonb,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_delivery_attempt_number_check" CHECK ("attempt_number" > 0),
	CONSTRAINT "integration_delivery_attempt_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
	CONSTRAINT "integration_delivery_attempt_http_status_check" CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599)
);
--> statement-breakpoint
CREATE TABLE "integration_delivery" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"route_id" text NOT NULL,
	"event_id" text NOT NULL,
	"action_key" text NOT NULL,
	"state" text NOT NULL,
	"ordering_key" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"exhausted_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"last_error" jsonb,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_delivery_attempt_count_check" CHECK ("attempt_count" >= 0),
	CONSTRAINT "integration_delivery_lease_state_check" CHECK (("state" = 'leased') = ("lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL)),
	CONSTRAINT "integration_delivery_terminal_timestamp_check" CHECK (("state" = 'succeeded') = ("succeeded_at" IS NOT NULL) AND ("state" = 'exhausted') = ("exhausted_at" IS NOT NULL) AND ("state" = 'canceled') = ("canceled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "integration_event" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"origin" jsonb NOT NULL,
	"causation_id" text,
	"correlation_id" text NOT NULL,
	"causal_hop_count" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_event_version_check" CHECK ("version" > 0),
	CONSTRAINT "integration_event_causal_hop_count_check" CHECK ("causal_hop_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "integration_route" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"capability_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"event_types" jsonb NOT NULL,
	"config_version" integer NOT NULL,
	"provider_config" jsonb NOT NULL,
	"safe_display_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_route_config_version_check" CHECK ("config_version" > 0)
);
--> statement-breakpoint
CREATE INDEX "integration_connection_organization_provider_idx" ON "integration_connection" ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "integration_connection_organization_lifecycle_idx" ON "integration_connection" ("organization_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_organization_id_uidx" ON "integration_connection" ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_delivery_attempt_delivery_number_uidx" ON "integration_delivery_attempt" ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "integration_delivery_attempt_delivery_started_idx" ON "integration_delivery_attempt" ("delivery_id","started_at");--> statement-breakpoint
CREATE INDEX "integration_delivery_attempt_retention_expires_at_idx" ON "integration_delivery_attempt" ("retention_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_delivery_route_event_action_uidx" ON "integration_delivery" ("route_id","event_id","action_key");--> statement-breakpoint
CREATE INDEX "integration_delivery_lease_claim_idx" ON "integration_delivery" ("state","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "integration_delivery_connection_state_idx" ON "integration_delivery" ("connection_id","state");--> statement-breakpoint
CREATE INDEX "integration_delivery_organization_state_idx" ON "integration_delivery" ("organization_id","state");--> statement-breakpoint
CREATE INDEX "integration_delivery_retention_expires_at_idx" ON "integration_delivery" ("retention_expires_at");--> statement-breakpoint
CREATE INDEX "integration_event_organization_occurred_at_idx" ON "integration_event" ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "integration_event_retention_expires_at_idx" ON "integration_event" ("retention_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_event_organization_id_uidx" ON "integration_event" ("organization_id","id");--> statement-breakpoint
CREATE INDEX "integration_route_connection_enabled_idx" ON "integration_route" ("connection_id","enabled");--> statement-breakpoint
CREATE INDEX "integration_route_organization_enabled_idx" ON "integration_route" ("organization_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_route_organization_id_uidx" ON "integration_route" ("organization_id","id");--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_delivery_attempt" ADD CONSTRAINT "integration_delivery_attempt_xOqDtFxhvWcc_fkey" FOREIGN KEY ("delivery_id") REFERENCES "integration_delivery"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_delivery" ADD CONSTRAINT "integration_delivery_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_delivery" ADD CONSTRAINT "integration_delivery_organization_connection_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "integration_connection"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_delivery" ADD CONSTRAINT "integration_delivery_organization_route_fkey" FOREIGN KEY ("organization_id","route_id") REFERENCES "integration_route"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_delivery" ADD CONSTRAINT "integration_delivery_organization_event_fkey" FOREIGN KEY ("organization_id","event_id") REFERENCES "integration_event"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_event" ADD CONSTRAINT "integration_event_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_route" ADD CONSTRAINT "integration_route_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_route" ADD CONSTRAINT "integration_route_organization_connection_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "integration_connection"("organization_id","id") ON DELETE CASCADE;