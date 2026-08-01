CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_embedding_metadata_chk" CHECK (("embedding" is null and "embedding_model" is null and "embedded_at" is null) or ("embedding" is not null and "embedding_model" is not null and "embedded_at" is not null)) NOT VALID;
