DROP INDEX "post_status_organizationId_type_uidx";--> statement-breakpoint
ALTER TABLE "post_status" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: a workspace's default is its PENDING status, which
-- DEFAULT_POST_STATUSES seeds and which is where the widget, Slack and Discord
-- already filed unnamed posts (they read the first status in display order, and
-- PENDING is seeded first). A workspace with no PENDING status — a row set
-- predating the seed — falls back to its lowest-orderIndex status, so exactly
-- one default exists per workspace before the index below asserts it.
UPDATE "post_status"
SET "is_default" = true
WHERE "id" IN (
  SELECT DISTINCT ON ("organization_id") "id"
  FROM "post_status"
  ORDER BY "organization_id", ("type" = 'PENDING') DESC, "order_index"
);--> statement-breakpoint
CREATE UNIQUE INDEX "post_status_organizationId_default_uidx" ON "post_status" ("organization_id") WHERE "is_default";
