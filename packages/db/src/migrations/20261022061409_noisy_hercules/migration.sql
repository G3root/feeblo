-- Suppression is scoped now: a row belongs to the workspace that observed the
-- bounce or complaint, or to the platform when the bounced mail belongs to no
-- workspace (verification, password reset, onboarding) or could not be
-- attributed. Existing rows become platform rows, which preserves today's
-- behaviour exactly: they matched every sender.
ALTER TABLE "email_suppression" DROP CONSTRAINT "email_suppression_pkey";--> statement-breakpoint
ALTER TABLE "email_suppression" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "email_suppression" ADD COLUMN "first_reason" text;--> statement-breakpoint
ALTER TABLE "email_suppression" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "email_suppression" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Uncorrelated provider feedback has no delivery to point at, but it still
-- joins the event ledger so a redelivered SNS message is a duplicate instead
-- of a second suppression or a double-counted metric. Deleting a delivery
-- nulls the reference rather than deleting the ledger row, because the event
-- id is the idempotency key.
ALTER TABLE "email_provider_event" ALTER COLUMN "delivery_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_provider_event" DROP CONSTRAINT "email_provider_event_delivery_id_email_delivery_id_fkey", ADD CONSTRAINT "email_provider_event_delivery_id_email_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "email_delivery"("id") ON DELETE SET NULL;--> statement-breakpoint

-- `email` was the primary key, so the table allowed any casing. Normalize it
-- before the check constraint and the case-sensitive unique indexes land.
-- Duplicates can only differ by case, so keep the newest row per address.
WITH ranked AS (
  SELECT
    "ctid",
    row_number() OVER (
      PARTITION BY lower(btrim("email"))
      ORDER BY "created_at" DESC, "ctid" DESC
    ) AS "position"
  FROM "email_suppression"
)
DELETE FROM "email_suppression" AS "suppression"
USING ranked
WHERE "suppression"."ctid" = ranked."ctid" AND ranked."position" > 1;--> statement-breakpoint
UPDATE "email_suppression" SET "email" = lower(btrim("email"));--> statement-breakpoint

-- The cause that created each legacy row is the reason it already carries.
UPDATE "email_suppression" SET "first_reason" = "reason" WHERE "first_reason" IS NULL;--> statement-breakpoint
ALTER TABLE "email_suppression" ALTER COLUMN "first_reason" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "email_suppression_email_platform_uidx" ON "email_suppression" ("email") WHERE "organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppression_organizationId_email_uidx" ON "email_suppression" ("organization_id","email") WHERE "organization_id" is not null;--> statement-breakpoint
CREATE INDEX "email_suppression_organizationId_createdAt_idx" ON "email_suppression" ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_email_normalized_chk" CHECK ("email" = lower(btrim("email")));--> statement-breakpoint
ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_note_chk" CHECK ("note" is null or (length("note") between 1 and 500));
