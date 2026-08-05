-- Rename the "member" role to "manager" and migrate existing rows.
-- The role column is text (no enum), so this is a pure data migration;
-- the schema default is updated in packages/db/src/schema/auth.ts.
UPDATE "member" SET "role" = 'manager' WHERE "role" = 'member';--> statement-breakpoint
UPDATE "invitation" SET "role" = 'manager' WHERE "role" = 'member';
