ALTER TABLE "help_center_article_feedback" DROP CONSTRAINT "help_center_article_feedback_ADsJS0oJx292_fkey";--> statement-breakpoint
ALTER TABLE "help_center_article_daily" DROP CONSTRAINT "help_center_article_daily_pgDlPfJgnRiS_fkey";--> statement-breakpoint
DROP INDEX "help_center_article_embedding_hnsw_idx";--> statement-breakpoint
DROP INDEX "help_center_article_view_event_articleId_occurredAt_idx";--> statement-breakpoint
DROP INDEX "help_center_search_daily_organizationId_day_searches_idx";