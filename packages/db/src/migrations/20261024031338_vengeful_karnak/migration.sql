-- Seventeen single-column indexes are dropped here. Each is a strict
-- leading-column prefix of a wider index on the same table, so every query and
-- every ON DELETE cascade that could use the short one still finds the long
-- one, and the only change is one fewer btree to maintain on every write.
--
-- `organization_slug_uidx` is the one exception: `organization_slug_unique`
-- already enforces uniqueness on `slug`, so a second unique index on the same
-- column bought nothing.
--
-- These drops are metadata-only, so unlike the index builds in
-- `20261020073319_rainy_adam_warlock` they are safe inside the migrator's
-- single transaction. None of them is an index that
-- `packages/db-migrator/src/index.ts` rebuilds with CREATE INDEX CONCURRENTLY.
DROP INDEX "member_organizationId_idx";--> statement-breakpoint
DROP INDEX "organization_slug_uidx";--> statement-breakpoint
DROP INDEX "post_status_organizationId_idx";--> statement-breakpoint
DROP INDEX "post_tag_postId_idx";--> statement-breakpoint
DROP INDEX "post_subscription_postId_idx";--> statement-breakpoint
DROP INDEX "jwt_secret_organizationId_idx";--> statement-breakpoint
DROP INDEX "user_emailHash_idx";--> statement-breakpoint
DROP INDEX "company_attribute_definition_organizationId_idx";--> statement-breakpoint
DROP INDEX "company_attribute_value_companyId_idx";--> statement-breakpoint
DROP INDEX "company_organizationId_idx";--> statement-breakpoint
DROP INDEX "contact_attribute_definition_organizationId_idx";--> statement-breakpoint
DROP INDEX "contact_attribute_value_contactId_idx";--> statement-breakpoint
DROP INDEX "contact_organizationId_idx";--> statement-breakpoint
DROP INDEX "roadmap_column_roadmapId_idx";--> statement-breakpoint
DROP INDEX "roadmap_organizationId_idx";--> statement-breakpoint
DROP INDEX "changelog_category_link_changelogId_idx";--> statement-breakpoint
DROP INDEX "changelog_subscription_organizationId_idx";