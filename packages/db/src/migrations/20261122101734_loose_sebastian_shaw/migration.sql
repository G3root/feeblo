CREATE TABLE "help_center_article_asset" (
	"article_id" text,
	"asset_id" text,
	CONSTRAINT "help_center_article_asset_pkey" PRIMARY KEY("article_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "help_center_article" ADD COLUMN "cover_image" text;--> statement-breakpoint
CREATE INDEX "help_center_article_asset_assetId_idx" ON "help_center_article_asset" ("asset_id");--> statement-breakpoint
ALTER TABLE "help_center_article_asset" ADD CONSTRAINT "help_center_article_asset_XmWukhrMT5DN_fkey" FOREIGN KEY ("article_id") REFERENCES "help_center_article"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_article_asset" ADD CONSTRAINT "help_center_article_asset_asset_id_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Backfill the images articles already saved. The orphan sweep reads only this
-- table, so an asset promoted before it existed would be deleted the next time
-- any changelog or post in the workspace is deleted.
INSERT INTO "help_center_article_asset" ("article_id", "asset_id")
SELECT "help_center_article"."id", "asset"."id"
FROM "help_center_article"
JOIN "asset" ON "asset"."organization_id" = "help_center_article"."organization_id"
WHERE "asset"."kind" IN ('editor_image', 'editor_video')
  AND (
    strpos("help_center_article"."content", "asset"."url") > 0
    OR "help_center_article"."cover_image" = "asset"."url"
  )
ON CONFLICT DO NOTHING;