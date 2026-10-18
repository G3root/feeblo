CREATE TABLE "plan_lock_selection" (
	"id" text PRIMARY KEY,
	"organization_id" text,
	"user_id" text,
	"feature_key" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_lock_selection_subject_chk" CHECK (num_nonnulls("organization_id", "user_id") = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "plan_lock_selection_organization_uidx" ON "plan_lock_selection" ("organization_id","feature_key","resource_id") WHERE "organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_lock_selection_user_uidx" ON "plan_lock_selection" ("user_id","feature_key","resource_id") WHERE "user_id" is not null;--> statement-breakpoint
ALTER TABLE "plan_lock_selection" ADD CONSTRAINT "plan_lock_selection_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plan_lock_selection" ADD CONSTRAINT "plan_lock_selection_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;