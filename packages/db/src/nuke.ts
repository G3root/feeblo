import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "./index";

export const nukeDatabase = Effect.fn("nukeDatabase")(function* () {
  const db = yield* Database.Database;

  yield* Effect.promise(() =>
    db.execute(
      sql.raw(`
      DO $$
      DECLARE
        tables_to_truncate text;
      BEGIN
        SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO tables_to_truncate
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '__drizzle_migrations';

        IF tables_to_truncate IS NOT NULL THEN
          EXECUTE 'TRUNCATE TABLE ' || tables_to_truncate || ' RESTART IDENTITY CASCADE';
        END IF;
      END
      $$;
    `)
    )
  );
});
