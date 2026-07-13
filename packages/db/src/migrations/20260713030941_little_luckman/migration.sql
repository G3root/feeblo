CREATE TYPE "attribute_data_type" AS ENUM('TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE');--> statement-breakpoint
CREATE TYPE "post_source" AS ENUM('DASHBOARD', 'WIDGET', 'API', 'IMPORT', 'PUBLIC_BOARD');--> statement-breakpoint
CREATE TABLE "company_attribute_definition" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"type" "attribute_data_type" NOT NULL,
	"config" jsonb,
	"is_required" boolean DEFAULT false NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_attribute_value" (
	"id" text PRIMARY KEY,
	"company_id" text NOT NULL,
	"attribute_id" text NOT NULL,
	"value_text" text,
	"value_integer" integer,
	"value_decimal" real,
	"value_boolean" boolean,
	"value_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"external_id" text,
	"avatar" text,
	"organization_id" text NOT NULL,
	"external_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_attribute_definition" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"type" "attribute_data_type" NOT NULL,
	"config" jsonb,
	"is_required" boolean DEFAULT false NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_attribute_value" (
	"id" text PRIMARY KEY,
	"contact_id" text NOT NULL,
	"attribute_id" text NOT NULL,
	"value_text" text,
	"value_integer" integer,
	"value_decimal" real,
	"value_boolean" boolean,
	"value_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY,
	"name" text,
	"email" text,
	"phone" text,
	"external_id" text,
	"avatar" text,
	"company_id" text,
	"user_id" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "jwt_auto_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "restricted_to_organization_id" text;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "contact_id" text;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "source" "post_source" DEFAULT 'DASHBOARD'::"post_source" NOT NULL;--> statement-breakpoint
CREATE INDEX "user_emailHash_idx" ON "user" ("email_hash");--> statement-breakpoint
CREATE INDEX "user_restricted_to_organization_id_idx" ON "user" ("restricted_to_organization_id");--> statement-breakpoint
CREATE INDEX "company_attribute_definition_organizationId_idx" ON "company_attribute_definition" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_attribute_definition_organizationId_key_uidx" ON "company_attribute_definition" ("organization_id","key");--> statement-breakpoint
CREATE INDEX "company_attribute_value_companyId_idx" ON "company_attribute_value" ("company_id");--> statement-breakpoint
CREATE INDEX "company_attribute_value_attributeId_idx" ON "company_attribute_value" ("attribute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_attribute_value_companyId_attributeId_uidx" ON "company_attribute_value" ("company_id","attribute_id");--> statement-breakpoint
CREATE INDEX "company_organizationId_idx" ON "company" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_organizationId_externalId_uidx" ON "company" ("organization_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_organizationId_name_uidx" ON "company" ("organization_id","name");--> statement-breakpoint
CREATE INDEX "contact_attribute_definition_organizationId_idx" ON "contact_attribute_definition" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_attribute_definition_organizationId_key_uidx" ON "contact_attribute_definition" ("organization_id","key");--> statement-breakpoint
CREATE INDEX "contact_attribute_value_contactId_idx" ON "contact_attribute_value" ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_attribute_value_attributeId_idx" ON "contact_attribute_value" ("attribute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_attribute_value_contactId_attributeId_uidx" ON "contact_attribute_value" ("contact_id","attribute_id");--> statement-breakpoint
CREATE INDEX "contact_organizationId_idx" ON "contact" ("organization_id");--> statement-breakpoint
CREATE INDEX "contact_companyId_idx" ON "contact" ("company_id");--> statement-breakpoint
CREATE INDEX "contact_userId_idx" ON "contact" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_organizationId_externalId_uidx" ON "contact" ("organization_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_organizationId_email_uidx" ON "contact" ("organization_id","email");--> statement-breakpoint
ALTER TABLE "company_attribute_definition" ADD CONSTRAINT "company_attribute_definition_kTIdzOEhY84w_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "company_attribute_value" ADD CONSTRAINT "company_attribute_value_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "company_attribute_value" ADD CONSTRAINT "company_attribute_value_llKdT8uQbpgY_fkey" FOREIGN KEY ("attribute_id") REFERENCES "company_attribute_definition"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_attribute_definition" ADD CONSTRAINT "contact_attribute_definition_kTIdzMCiJSi5_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_attribute_value" ADD CONSTRAINT "contact_attribute_value_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_attribute_value" ADD CONSTRAINT "contact_attribute_value_4kkzVjc1dj7o_fkey" FOREIGN KEY ("attribute_id") REFERENCES "contact_attribute_definition"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL;