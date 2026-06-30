CREATE TABLE "post_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"member_id" text,
	"post_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_subscription" ADD CONSTRAINT "post_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_subscription" ADD CONSTRAINT "post_subscription_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_subscription" ADD CONSTRAINT "post_subscription_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_subscription" ADD CONSTRAINT "post_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_subscription_postId_idx" ON "post_subscription" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_subscription_userId_idx" ON "post_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_subscription_postId_userId_uidx" ON "post_subscription" USING btree ("post_id","user_id");