ALTER TABLE "comment" ADD COLUMN "merged_from_post_id" text;--> statement-breakpoint
ALTER TABLE "upvote" ADD COLUMN "merged_from_post_id" text;--> statement-breakpoint
CREATE INDEX "comment_mergedFromPostId_idx" ON "comment" ("merged_from_post_id");--> statement-breakpoint
CREATE INDEX "upvote_mergedFromPostId_idx" ON "upvote" ("merged_from_post_id");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_merged_from_post_id_post_id_fkey" FOREIGN KEY ("merged_from_post_id") REFERENCES "post"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "upvote" ADD CONSTRAINT "upvote_merged_from_post_id_post_id_fkey" FOREIGN KEY ("merged_from_post_id") REFERENCES "post"("id") ON DELETE SET NULL;