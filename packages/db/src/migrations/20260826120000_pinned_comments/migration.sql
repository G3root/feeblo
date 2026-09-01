ALTER TABLE "comment" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "comment_organizationId_postId_idx" ON "comment" USING btree ("organization_id","post_id");--> statement-breakpoint
CREATE INDEX "comment_postId_pinnedAt_idx" ON "comment" USING btree ("post_id","pinned_at");
