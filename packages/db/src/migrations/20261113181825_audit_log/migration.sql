CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_token_id" text,
	"actor_label" text,
	"actor_role" text,
	"affected_user_id" text,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"denial_reason" text,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"changes" jsonb,
	"metadata" jsonb,
	"request_id" text,
	"origin_ip" text,
	"origin_country" text,
	"user_agent" text,
	CONSTRAINT "audit_log_resourceType_derived_chk" CHECK ("resource_type" = split_part("action", '.', 1)),
	CONSTRAINT "audit_log_denial_reason_chk" CHECK (("outcome" = 'allowed' and "denial_reason" is null) or ("outcome" = 'denied' and "denial_reason" is not null)),
	CONSTRAINT "audit_log_actor_chk" CHECK ("actor_type" = 'system' or "actor_user_id" is not null or "actor_token_id" is not null),
	CONSTRAINT "audit_log_actor_role_chk" CHECK ("actor_role" is null or "actor_type" = 'user' or "actor_type" = 'oauth_client')
);
--> statement-breakpoint
CREATE INDEX "audit_log_org_occurredAt_idx" ON "audit_log" ("organization_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_org_action_idx" ON "audit_log" ("organization_id","action","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_org_resource_idx" ON "audit_log" ("organization_id","resource_type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_org_actor_idx" ON "audit_log" ("organization_id","actor_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_changedFields_idx" ON "audit_log" USING gin (("changes" -> 'fields'));--> statement-breakpoint
CREATE INDEX "audit_log_denied_idx" ON "audit_log" ("organization_id","occurred_at" DESC NULLS LAST) WHERE "outcome" = 'denied';--> statement-breakpoint
CREATE INDEX "audit_log_occurredAt_idx" ON "audit_log" ("occurred_at");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('feeblo.audit_retention', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_log_append_only" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();--> statement-breakpoint
