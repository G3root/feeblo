CREATE TYPE "help_center_visibility" AS ENUM('PUBLIC', 'HIDDEN');--> statement-breakpoint
CREATE TABLE "help_center_article_feedback" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"article_id" text NOT NULL,
	"user_id" text,
	"visitor_id" text,
	"helpful" boolean NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_center_article_feedback_identity_chk" CHECK (("user_id" is not null) <> ("visitor_id" is not null)),
	CONSTRAINT "help_center_article_feedback_reason_chk" CHECK (not "helpful" or "reason" is null)
);
--> statement-breakpoint
CREATE TABLE "help_center_article" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"published_at" timestamp with time zone,
	"source" text DEFAULT 'EDITOR' NOT NULL,
	"creator_member_id" text,
	"position" integer,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_center_article_published_at_chk" CHECK ("status" = 'draft' or "published_at" is not null),
	CONSTRAINT "help_center_article_embedding_metadata_chk" CHECK (("embedding" is null and "embedding_model" is null and "embedded_at" is null) or ("embedding" is not null and "embedding_model" is not null and "embedded_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "help_center_article_view_event" (
	"id" text PRIMARY KEY,
	"article_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_center_article_view_total" (
	"article_id" text PRIMARY KEY,
	"views" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_center_topic" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "help_center_visibility" "help_center_visibility" DEFAULT 'PUBLIC'::"help_center_visibility" NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "help_center_article_feedback_articleId_userId_uidx" ON "help_center_article_feedback" ("article_id","user_id") WHERE "user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "help_center_article_feedback_articleId_visitorId_uidx" ON "help_center_article_feedback" ("article_id","visitor_id") WHERE "visitor_id" is not null;--> statement-breakpoint
CREATE INDEX "help_center_article_feedback_articleId_helpful_idx" ON "help_center_article_feedback" ("article_id","helpful");--> statement-breakpoint
CREATE INDEX "help_center_article_feedback_reason_idx" ON "help_center_article_feedback" ("article_id","created_at") WHERE "reason" is not null;--> statement-breakpoint
CREATE INDEX "help_center_article_feedback_organizationId_idx" ON "help_center_article_feedback" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "help_center_article_organizationId_slug_uidx" ON "help_center_article" ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "help_center_article_id_organizationId_uidx" ON "help_center_article" ("id","organization_id");--> statement-breakpoint
CREATE INDEX "help_center_article_topicId_status_position_idx" ON "help_center_article" ("topic_id","status","position");--> statement-breakpoint
CREATE INDEX "help_center_article_organizationId_status_publishedAt_idx" ON "help_center_article" ("organization_id","status","published_at");--> statement-breakpoint
CREATE INDEX "help_center_article_creatorMemberId_idx" ON "help_center_article" ("creator_member_id");--> statement-breakpoint
CREATE INDEX "help_center_article_embedding_hnsw_idx" ON "help_center_article" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" is not null;--> statement-breakpoint
CREATE INDEX "help_center_article_view_event_articleId_occurredAt_idx" ON "help_center_article_view_event" ("article_id","occurred_at");--> statement-breakpoint
CREATE INDEX "help_center_article_view_event_occurredAt_idx" ON "help_center_article_view_event" ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "help_center_topic_organizationId_slug_uidx" ON "help_center_topic" ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "help_center_topic_id_organizationId_uidx" ON "help_center_topic" ("id","organization_id");--> statement-breakpoint
CREATE INDEX "help_center_topic_organizationId_position_idx" ON "help_center_topic" ("organization_id","position");--> statement-breakpoint
ALTER TABLE "help_center_article_feedback" ADD CONSTRAINT "help_center_article_feedback_7mA1agXS4vCu_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_article_feedback" ADD CONSTRAINT "help_center_article_feedback_ADsJS0oJx292_fkey" FOREIGN KEY ("article_id") REFERENCES "help_center_article"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_article_feedback" ADD CONSTRAINT "help_center_article_feedback_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "help_center_article" ADD CONSTRAINT "help_center_article_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_article" ADD CONSTRAINT "help_center_article_creator_member_id_member_id_fkey" FOREIGN KEY ("creator_member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "help_center_article" ADD CONSTRAINT "help_center_article_topic_organization_fk" FOREIGN KEY ("topic_id","organization_id") REFERENCES "help_center_topic"("id","organization_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "help_center_article_view_event" ADD CONSTRAINT "help_center_article_view_event_ncXxphgKNOjx_fkey" FOREIGN KEY ("article_id") REFERENCES "help_center_article"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_article_view_total" ADD CONSTRAINT "help_center_article_view_total_UoTqPji7WtzT_fkey" FOREIGN KEY ("article_id") REFERENCES "help_center_article"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "help_center_topic" ADD CONSTRAINT "help_center_topic_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;