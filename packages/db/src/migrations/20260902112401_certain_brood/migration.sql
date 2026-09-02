ALTER TABLE "comment" ADD COLUMN "status_update_id" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "comment_organizationId_postId_idx" ON "comment" ("organization_id","post_id");--> statement-breakpoint
CREATE INDEX "comment_postId_pinnedAt_idx" ON "comment" ("post_id","pinned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_post_pinned_uidx" ON "comment" ("post_id") WHERE "pinned_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_status_update_id_post_status_id_fkey" FOREIGN KEY ("status_update_id") REFERENCES "post_status"("id") ON DELETE SET NULL;