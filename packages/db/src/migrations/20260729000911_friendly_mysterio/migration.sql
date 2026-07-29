ALTER TABLE "feedback_receipt" ADD COLUMN "attached_post_id" text;--> statement-breakpoint
CREATE INDEX "feedback_receipt_attachedPostId_idx" ON "feedback_receipt" ("attached_post_id");--> statement-breakpoint
ALTER TABLE "feedback_receipt" ADD CONSTRAINT "feedback_receipt_attached_post_id_post_id_fkey" FOREIGN KEY ("attached_post_id") REFERENCES "post"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feedback_receipt" ADD CONSTRAINT "feedback_receipt_attached_post_stage_chk" CHECK ("attached_post_id" is null or "pipeline_stage" = 'READY');