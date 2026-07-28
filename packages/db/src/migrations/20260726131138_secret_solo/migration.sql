CREATE TYPE "post_activity_kind" AS ENUM('POST_CREATED', 'TITLE_CHANGED', 'CONTENT_CHANGED', 'STATUS_CHANGED', 'BOARD_CHANGED', 'POST_LOCKED', 'POST_UNLOCKED', 'POST_ARCHIVED', 'POST_UNARCHIVED', 'COMMENT_CREATED', 'COMMENT_UPDATED', 'COMMENT_DELETED');--> statement-breakpoint
CREATE TABLE "post_activity" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"post_id" text NOT NULL,
	"actor_id" text,
	"actor_member_id" text,
	"kind" "post_activity_kind" NOT NULL,
	"previous_value" text,
	"next_value" text,
	"comment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "post_activity_postId_createdAt_idx" ON "post_activity" ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "post_activity_organizationId_idx" ON "post_activity" ("organization_id");--> statement-breakpoint
ALTER TABLE "post_activity" ADD CONSTRAINT "post_activity_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_activity" ADD CONSTRAINT "post_activity_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_activity" ADD CONSTRAINT "post_activity_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "post_activity" ADD CONSTRAINT "post_activity_actor_member_id_member_id_fkey" FOREIGN KEY ("actor_member_id") REFERENCES "member"("id") ON DELETE SET NULL;