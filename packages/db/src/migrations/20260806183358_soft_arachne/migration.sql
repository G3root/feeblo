CREATE TABLE "changelog_category_link" (
	"id" text PRIMARY KEY,
	"changelog_id" text NOT NULL,
	"category_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changelog_category" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"icon_type" text DEFAULT 'color' NOT NULL,
	"icon" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "changelog_category_link_changelogId_idx" ON "changelog_category_link" ("changelog_id");--> statement-breakpoint
CREATE INDEX "changelog_category_link_categoryId_idx" ON "changelog_category_link" ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_category_link_changelogId_categoryId_uidx" ON "changelog_category_link" ("changelog_id","category_id");--> statement-breakpoint
CREATE INDEX "changelog_category_organizationId_idx" ON "changelog_category" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_category_organizationId_name_uidx" ON "changelog_category" ("organization_id","name");--> statement-breakpoint
ALTER TABLE "changelog_category_link" ADD CONSTRAINT "changelog_category_link_changelog_id_changelog_id_fkey" FOREIGN KEY ("changelog_id") REFERENCES "changelog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_category_link" ADD CONSTRAINT "changelog_category_link_category_id_changelog_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "changelog_category"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_category_link" ADD CONSTRAINT "changelog_category_link_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_category" ADD CONSTRAINT "changelog_category_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;