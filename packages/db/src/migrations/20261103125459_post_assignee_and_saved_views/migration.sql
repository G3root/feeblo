CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"board_id" text,
	"name" text NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"description" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"query" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "assignee_member_id" text;--> statement-breakpoint
CREATE INDEX "post_organizationId_assigneeMemberId_idx" ON "post" ("organization_id","assignee_member_id");--> statement-breakpoint
CREATE INDEX "saved_view_organizationId_memberId_idx" ON "saved_view" ("organization_id","member_id");--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_assignee_member_id_member_id_fkey" FOREIGN KEY ("assignee_member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_member_id_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_board_id_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE CASCADE;