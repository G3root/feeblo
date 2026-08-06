-- better-auth >= 1.7 keys accounts by (issuer, account_id).
-- Idempotent on purpose: staging/prod already created and backfilled the
-- column manually, so every statement is guarded with IF NOT EXISTS and the
-- NOT NULL constraint is enforced separately (only after rows carry values).
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_account_id_uidx" ON "account" ("issuer","account_id");
