CREATE TABLE "changelog_post" (
	"changelog_id" text,
	"post_id" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changelog_post_pkey" PRIMARY KEY("changelog_id","post_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_post_postId_uidx" ON "changelog_post" ("post_id");--> statement-breakpoint
CREATE INDEX "changelog_post_organizationId_idx" ON "changelog_post" ("organization_id");--> statement-breakpoint
ALTER TABLE "changelog_post" ADD CONSTRAINT "changelog_post_changelog_id_changelog_id_fkey" FOREIGN KEY ("changelog_id") REFERENCES "changelog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_post" ADD CONSTRAINT "changelog_post_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "changelog_post" ADD CONSTRAINT "changelog_post_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;