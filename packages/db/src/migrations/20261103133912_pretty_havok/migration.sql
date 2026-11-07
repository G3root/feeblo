CREATE TABLE "user_ban" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text,
	"email" text,
	"reason" text,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ban_subject_chk" CHECK ("user_id" is not null or "email" is not null),
	CONSTRAINT "user_ban_email_normalized_chk" CHECK ("email" is null or "email" = lower(btrim("email"))),
	CONSTRAINT "user_ban_reason_chk" CHECK ("reason" is null or (length("reason") between 1 and 500))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_ban_organizationId_userId_uidx" ON "user_ban" ("organization_id","user_id") WHERE "user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_ban_organizationId_email_uidx" ON "user_ban" ("organization_id","email") WHERE "email" is not null;--> statement-breakpoint
CREATE INDEX "user_ban_organizationId_createdAt_idx" ON "user_ban" ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "user_ban" ADD CONSTRAINT "user_ban_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_ban" ADD CONSTRAINT "user_ban_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "user_ban" ADD CONSTRAINT "user_ban_created_by_member_id_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "member"("id") ON DELETE SET NULL;