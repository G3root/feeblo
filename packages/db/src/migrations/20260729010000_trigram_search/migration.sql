DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS post_title_trgm_idx ON "post" USING GIN ("title" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS post_excerpt_trgm_idx ON "post" USING GIN ("excerpt" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm extension not available, skipping trigram indexes: %', SQLERRM;
END $$;
