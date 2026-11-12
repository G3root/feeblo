CREATE TABLE "post_view_event" (
	"id" text PRIMARY KEY,
	"occurred_at" timestamp with time zone NOT NULL,
	"post_id" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"os" text DEFAULT '' NOT NULL,
	"browser" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_view_total" (
	"post_id" text PRIMARY KEY,
	"views" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "post_view_event_postId_occurredAt_idx" ON "post_view_event" ("post_id","occurred_at");--> statement-breakpoint
ALTER TABLE "post_view_event" ADD CONSTRAINT "post_view_event_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_view_total" ADD CONSTRAINT "post_view_total_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE;