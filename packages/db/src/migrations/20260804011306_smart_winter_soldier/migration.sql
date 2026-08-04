CREATE TABLE "changelog_asset" (
	"changelog_id" text,
	"asset_id" text,
	CONSTRAINT "changelog_asset_pkey" PRIMARY KEY("changelog_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "post_asset" (
	"post_id" text,
	"asset_id" text,
	CONSTRAINT "post_asset_pkey" PRIMARY KEY("post_id","asset_id")
);
--> statement-breakpoint
CREATE INDEX "changelog_asset_assetId_idx" ON "changelog_asset" ("asset_id");--> statement-breakpoint
CREATE INDEX "post_asset_assetId_idx" ON "post_asset" ("asset_id");--> statement-breakpoint
ALTER TABLE "changelog_asset" ADD CONSTRAINT "changelog_asset_changelog_id_changelog_id_fkey" FOREIGN KEY ("changelog_id") REFERENCES "changelog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_asset" ADD CONSTRAINT "changelog_asset_asset_id_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_asset" ADD CONSTRAINT "post_asset_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_asset" ADD CONSTRAINT "post_asset_asset_id_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE;