ALTER TABLE "post" ADD COLUMN "author_name" text;--> statement-breakpoint
CREATE INDEX "post_contactId_idx" ON "post" ("contact_id");--> statement-breakpoint
-- Backfill the display name for posts that already name a contact, matching
-- what the write path now stores. Without it, deleting one of these contacts
-- would still leave its contact-only posts with no author at all.
UPDATE "post" p
SET "author_name" = COALESCE(c."name", c."email")
FROM "contact" c
WHERE c."id" = p."contact_id";
