CREATE TYPE "roadmap_mode" AS ENUM('status', 'filtered');--> statement-breakpoint
CREATE TYPE "saved_roadmap_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "roadmap_column" (
	"id" text PRIMARY KEY,
	"roadmap_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"mode" "roadmap_mode" NOT NULL,
	"visibility" "saved_roadmap_visibility" NOT NULL,
	"filter" jsonb NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "roadmap_column_roadmapId_idx" ON "roadmap_column" ("roadmap_id");--> statement-breakpoint
CREATE INDEX "roadmap_column_roadmapId_position_idx" ON "roadmap_column" ("roadmap_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmap_organizationId_slug_uidx" ON "roadmap" ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "roadmap_organizationId_idx" ON "roadmap" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmap_primary_organizationId_uidx" ON "roadmap" ("organization_id") WHERE "is_primary";--> statement-breakpoint
ALTER TABLE "roadmap_column" ADD CONSTRAINT "roadmap_column_roadmap_id_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "roadmap"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "roadmap" ADD CONSTRAINT "roadmap_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;