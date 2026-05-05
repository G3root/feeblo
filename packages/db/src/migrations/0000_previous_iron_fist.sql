CREATE TYPE "public"."board_visibility" AS ENUM('PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."changelog_status" AS ENUM('draft', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."changelog_visibility" AS ENUM('PUBLIC', 'HIDDEN');--> statement-breakpoint
CREATE TYPE "public"."post_comment_visibility" AS ENUM('PUBLIC', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."post_icon_type" AS ENUM('EMOJI');--> statement-breakpoint
CREATE TYPE "public"."post_status_types" AS ENUM('PENDING', 'REVIEW', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."roadmap_visibility" AS ENUM('PUBLIC', 'HIDDEN');--> statement-breakpoint
CREATE TYPE "public"."tag_type" AS ENUM('FEEDBACK', 'CHANGELOG');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trial_interval" text,
	"trial_interval_count" integer,
	"recurring_interval" text,
	"recurring_interval_count" integer,
	"is_recurring" boolean NOT NULL,
	"is_archived" boolean NOT NULL,
	"external_organization_id" text NOT NULL,
	"visibility" text NOT NULL,
	"prices" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"amount" real NOT NULL,
	"cancel_at_period_end" boolean NOT NULL,
	"currency" text NOT NULL,
	"recurring_interval" text NOT NULL,
	"recurring_interval_count" integer NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"customer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"discount_id" text,
	"checkout_id" text,
	"seats" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscription_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false,
	"last_login_method" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"visibility" "board_visibility" NOT NULL,
	"organization_id" text NOT NULL,
	"creator_id" text,
	"creator_member_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changelog" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"status" "changelog_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"organization_id" text NOT NULL,
	"creator_id" text,
	"creator_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changelog_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"changelog_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"organization_id" text NOT NULL,
	"post_id" text NOT NULL,
	"user_id" text NOT NULL,
	"member_id" text,
	"visibility" "post_comment_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_comment_id" text
);
--> statement-breakpoint
CREATE TABLE "comment_reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"member_id" text,
	"comment_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"board_id" text NOT NULL,
	"status_schema_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"creator_id" text,
	"creator_member_id" text,
	"locked_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"merged_into_post_id" text,
	"merged_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "post_merge_requires_target_and_timestamp_chk" CHECK (("post"."merged_into_post_id" is null and "post"."merged_at" is null) or ("post"."merged_into_post_id" is not null and "post"."merged_at" is not null)),
	CONSTRAINT "post_merged_rows_must_be_archived_chk" CHECK ("post"."merged_into_post_id" is null or "post"."archived_at" is not null),
	CONSTRAINT "post_no_self_merge_chk" CHECK ("post"."merged_into_post_id" is null or "post"."merged_into_post_id" <> "post"."id")
);
--> statement-breakpoint
CREATE TABLE "post_reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"member_id" text,
	"post_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_status" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "post_status_types" NOT NULL,
	"order_index" integer NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"custom_domain" text,
	"changelog_visibility" "changelog_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"roadmap_visibility" "roadmap_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"hide_powered_by" boolean DEFAULT false NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "tag_type" NOT NULL,
	"organization_id" text NOT NULL,
	"creator_id" text,
	"creator_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upvote" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"member_id" text,
	"post_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_creator_member_id_member_id_fk" FOREIGN KEY ("creator_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog" ADD CONSTRAINT "changelog_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog" ADD CONSTRAINT "changelog_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog" ADD CONSTRAINT "changelog_creator_member_id_member_id_fk" FOREIGN KEY ("creator_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_tag" ADD CONSTRAINT "changelog_tag_changelog_id_changelog_id_fk" FOREIGN KEY ("changelog_id") REFERENCES "public"."changelog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_tag" ADD CONSTRAINT "changelog_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_tag" ADD CONSTRAINT "changelog_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_comment_id_comment_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_status_schema_id_post_status_id_fk" FOREIGN KEY ("status_schema_id") REFERENCES "public"."post_status"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_creator_member_id_member_id_fk" FOREIGN KEY ("creator_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_id_organizationId_uidx" ON "post" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_merged_into_same_organization_fk" FOREIGN KEY ("merged_into_post_id","organization_id") REFERENCES "public"."post"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reaction" ADD CONSTRAINT "post_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reaction" ADD CONSTRAINT "post_reaction_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reaction" ADD CONSTRAINT "post_reaction_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_status" ADD CONSTRAINT "post_status_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tag" ADD CONSTRAINT "post_tag_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tag" ADD CONSTRAINT "post_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tag" ADD CONSTRAINT "post_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_creator_member_id_member_id_fk" FOREIGN KEY ("creator_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upvote" ADD CONSTRAINT "upvote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upvote" ADD CONSTRAINT "upvote_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upvote" ADD CONSTRAINT "upvote_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organizationId_userId_uidx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "board_organizationId_slug_uidx" ON "board" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_organizationId_slug_uidx" ON "changelog" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "changelog_tag_changelogId_idx" ON "changelog_tag" USING btree ("changelog_id");--> statement-breakpoint
CREATE INDEX "changelog_tag_tagId_idx" ON "changelog_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_tag_changelogId_tagId_uidx" ON "changelog_tag" USING btree ("changelog_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commentReaction_userId_commentId_emoji_uidx" ON "comment_reaction" USING btree ("user_id","comment_id","emoji");--> statement-breakpoint
CREATE INDEX "post_statusId_idx" ON "post" USING btree ("status_schema_id");--> statement-breakpoint
CREATE INDEX "post_archivedAt_idx" ON "post" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "post_mergedIntoPostId_idx" ON "post" USING btree ("merged_into_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_organizationId_boardId_slug_uidx" ON "post" USING btree ("organization_id","board_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "postReaction_userId_postId_emoji_uidx" ON "post_reaction" USING btree ("user_id","post_id","emoji");--> statement-breakpoint
CREATE INDEX "post_status_organizationId_idx" ON "post_status" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_status_organizationId_type_uidx" ON "post_status" USING btree ("organization_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "post_status_organizationId_orderIndex_uidx" ON "post_status" USING btree ("organization_id","order_index");--> statement-breakpoint
CREATE INDEX "post_tag_postId_idx" ON "post_tag" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_tag_tagId_idx" ON "post_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_tag_postId_tagId_uidx" ON "post_tag" USING btree ("post_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_organizationId_uidx" ON "site" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_organizationId_type_name_uidx" ON "tag" USING btree ("organization_id","type","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_organizationId_type_slug_uidx" ON "tag" USING btree ("organization_id","type","slug");--> statement-breakpoint
CREATE INDEX "upvote_postId_idx" ON "upvote" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upvote_userId_postId_uidx" ON "upvote" USING btree ("user_id","post_id");
