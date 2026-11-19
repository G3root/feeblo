CREATE TABLE "help_center_article_daily" (
	"organization_id" text NOT NULL,
	"article_id" text,
	"day" date,
	"views" integer DEFAULT 0 NOT NULL,
	"helpful_verdicts" integer DEFAULT 0 NOT NULL,
	"unhelpful_verdicts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "help_center_article_daily_pkey" PRIMARY KEY("article_id","day"),
	CONSTRAINT "help_center_article_daily_counts_chk" CHECK ("views" >= 0 and "helpful_verdicts" >= 0 and "unhelpful_verdicts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "help_center_search_daily" (
	"organization_id" text,
	"day" date,
	"query" text,
	"searches" integer DEFAULT 0 NOT NULL,
	"empty_searches" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "help_center_search_daily_pkey" PRIMARY KEY("organization_id","day","query"),
	CONSTRAINT "help_center_search_daily_counts_chk" CHECK ("searches" >= 0 and "empty_searches" >= 0 and "empty_searches" <= "searches")
);
--> statement-breakpoint
ALTER TABLE "help_center_article" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, title), 'A') || setweight(to_tsvector('english'::regconfig, excerpt), 'B') || setweight(to_tsvector('english'::regconfig, content), 'C')) STORED;--> statement-breakpoint
CREATE INDEX "help_center_article_daily_organizationId_day_idx" ON "help_center_article_daily" ("organization_id","day");--> statement-breakpoint
CREATE INDEX "help_center_article_search_vector_idx" ON "help_center_article" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "help_center_search_daily_organizationId_day_searches_idx" ON "help_center_search_daily" ("organization_id","day","searches" desc);--> statement-breakpoint
ALTER TABLE "help_center_article_daily" ADD CONSTRAINT "help_center_article_daily_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_article_daily" ADD CONSTRAINT "help_center_article_daily_pgDlPfJgnRiS_fkey" FOREIGN KEY ("article_id") REFERENCES "help_center_article"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_article_daily" ADD CONSTRAINT "help_center_article_daily_article_organization_fk" FOREIGN KEY ("article_id","organization_id") REFERENCES "help_center_article"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_search_daily" ADD CONSTRAINT "help_center_search_daily_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;