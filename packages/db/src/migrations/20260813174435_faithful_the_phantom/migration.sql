CREATE TABLE "github_installation" (
	"connection_id" text PRIMARY KEY,
	"installation_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "github_installation_installation_id_uidx" ON "github_installation" ("installation_id");--> statement-breakpoint
CREATE INDEX "github_installation_account_idx" ON "github_installation" ("account_id");--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_hxjCxRRkLkaP_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connection"("id") ON DELETE CASCADE;