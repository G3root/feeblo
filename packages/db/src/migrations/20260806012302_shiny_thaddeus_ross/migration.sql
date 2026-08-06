-- better-auth >= 1.7 identifies OAuth identities by issuer (RFC 9207).
-- Add nullable first, backfill existing rows with the synthetic issuers
-- better-auth computes (local:credential for email/password, local:oauth:<providerId>
-- for social accounts), then enforce NOT NULL.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account"
SET "issuer" = CASE
  WHEN "provider_id" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "provider_id"
END
WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "account_issuer_accountId_idx" ON "account" ("issuer","account_id");--> statement-breakpoint
