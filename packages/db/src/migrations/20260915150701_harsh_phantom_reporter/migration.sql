ALTER TABLE "changelog_post" ADD COLUMN "merged_from_post_id" text;--> statement-breakpoint
ALTER TABLE "email_subscription" ADD COLUMN "merged_from_post_id" text;--> statement-breakpoint
ALTER TABLE "post_reaction" ADD COLUMN "merged_from_post_id" text;--> statement-breakpoint
ALTER TABLE "post_subscription" ADD COLUMN "merged_from_post_id" text;--> statement-breakpoint
ALTER TABLE "post_tag" ADD COLUMN "merged_from_post_id" text;--> statement-breakpoint
CREATE INDEX "changelog_post_mergedFromPostId_idx" ON "changelog_post" ("merged_from_post_id");--> statement-breakpoint
CREATE INDEX "email_subscription_mergedFromPostId_idx" ON "email_subscription" ("merged_from_post_id");--> statement-breakpoint
CREATE INDEX "postReaction_mergedFromPostId_idx" ON "post_reaction" ("merged_from_post_id");--> statement-breakpoint
CREATE INDEX "post_subscription_mergedFromPostId_idx" ON "post_subscription" ("merged_from_post_id");--> statement-breakpoint
CREATE INDEX "post_tag_mergedFromPostId_idx" ON "post_tag" ("merged_from_post_id");--> statement-breakpoint
ALTER TABLE "changelog_post" ADD CONSTRAINT "changelog_post_merged_from_post_id_post_id_fkey" FOREIGN KEY ("merged_from_post_id") REFERENCES "post"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_subscription" ADD CONSTRAINT "email_subscription_merged_from_post_id_post_id_fkey" FOREIGN KEY ("merged_from_post_id") REFERENCES "post"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "post_reaction" ADD CONSTRAINT "post_reaction_merged_from_post_id_post_id_fkey" FOREIGN KEY ("merged_from_post_id") REFERENCES "post"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "post_subscription" ADD CONSTRAINT "post_subscription_merged_from_post_id_post_id_fkey" FOREIGN KEY ("merged_from_post_id") REFERENCES "post"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "post_tag" ADD CONSTRAINT "post_tag_merged_from_post_id_post_id_fkey" FOREIGN KEY ("merged_from_post_id") REFERENCES "post"("id") ON DELETE SET NULL;