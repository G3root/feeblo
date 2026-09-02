ALTER TABLE "comment" ADD COLUMN "status_update_id" text;--> statement-breakpoint
ALTER TABLE "comment" DROP COLUMN "status_update_type";--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_status_update_id_post_status_id_fkey" FOREIGN KEY ("status_update_id") REFERENCES "post_status"("id") ON DELETE SET NULL;