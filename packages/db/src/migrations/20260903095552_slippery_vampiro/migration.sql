CREATE INDEX "commentReaction_commentId_idx" ON "comment_reaction" ("comment_id");--> statement-breakpoint
CREATE INDEX "postReaction_postId_idx" ON "post_reaction" ("post_id");--> statement-breakpoint
CREATE INDEX "post_organizationId_boardId_createdAt_idx" ON "post" ("organization_id","board_id","created_at");--> statement-breakpoint
CREATE INDEX "upvote_organizationId_postId_idx" ON "upvote" ("organization_id","post_id");