CREATE TABLE "jwt_secret" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "jwt_secret_organizationId_secret_revokedAt_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","secret","revoked_at")
);
--> statement-breakpoint
CREATE INDEX "jwt_secret_organizationId_idx" ON "jwt_secret" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jwt_secret_organizationId_active_uidx" ON "jwt_secret" ("organization_id") WHERE "revoked_at" is null;--> statement-breakpoint
ALTER TABLE "jwt_secret" ADD CONSTRAINT "jwt_secret_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post" DROP CONSTRAINT "post_merge_requires_target_and_timestamp_chk", ADD CONSTRAINT "post_merge_requires_target_and_timestamp_chk" CHECK (("merged_into_post_id" is null and "merged_at" is null) or ("merged_into_post_id" is not null and "merged_at" is not null));--> statement-breakpoint
ALTER TABLE "post" DROP CONSTRAINT "post_merged_rows_must_be_archived_chk", ADD CONSTRAINT "post_merged_rows_must_be_archived_chk" CHECK ("merged_into_post_id" is null or "archived_at" is not null);--> statement-breakpoint
ALTER TABLE "post" DROP CONSTRAINT "post_no_self_merge_chk", ADD CONSTRAINT "post_no_self_merge_chk" CHECK ("merged_into_post_id" is null or "merged_into_post_id" <> "id");