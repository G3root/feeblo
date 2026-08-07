ALTER INDEX "post_organizationId_boardId_slug_uidx" RENAME TO "post_organizationId_slug_uidx";--> statement-breakpoint
DROP INDEX "post_organizationId_slug_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "post_organizationId_slug_uidx" ON "post" ("organization_id","slug");
