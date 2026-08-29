CREATE TABLE "changelog_subscription" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"member_id" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_recipient_member_id_member_id_fkey";--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_actor_member_id_member_id_fkey";--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "recipient_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "notification" DROP COLUMN "recipient_member_id";--> statement-breakpoint
ALTER TABLE "notification" DROP COLUMN "actor_member_id";--> statement-breakpoint
-- The two recipient_* indexes were dropped implicitly by the DROP COLUMNs
-- above (Postgres removes indexes on a dropped column).
CREATE INDEX "notification_recipient_read_created_idx" ON "notification" ("recipient_user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_deduplication_uidx" ON "notification" ("recipient_user_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "changelog_subscription_organizationId_idx" ON "changelog_subscription" ("organization_id");--> statement-breakpoint
CREATE INDEX "changelog_subscription_userId_idx" ON "changelog_subscription" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_subscription_organizationId_userId_uidx" ON "changelog_subscription" ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "changelog_subscription" ADD CONSTRAINT "changelog_subscription_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_subscription" ADD CONSTRAINT "changelog_subscription_member_id_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "changelog_subscription" ADD CONSTRAINT "changelog_subscription_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL;