CREATE TABLE "notification" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"recipient_member_id" text NOT NULL,
	"actor_member_id" text,
	"kind" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_recipient_read_created_idx" ON "notification" ("recipient_member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notification_organization_idx" ON "notification" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_deduplication_uidx" ON "notification" ("recipient_member_id","deduplication_key");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_member_id_member_id_fkey" FOREIGN KEY ("recipient_member_id") REFERENCES "member"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_member_id_member_id_fkey" FOREIGN KEY ("actor_member_id") REFERENCES "member"("id") ON DELETE SET NULL;