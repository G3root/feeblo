import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle as devDrizzle } from "drizzle-orm/pglite";
import { migrate as devMigrate } from "drizzle-orm/pglite/migrator";
import { drizzle as prodDrizzle } from "drizzle-orm/postgres-js";
import { migrate as prodMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

const runMigrate = async () => {
  const DB_URL = process.env.DATABASE_URL;
  if (!DB_URL) {
    console.log("DATABASE_URL not defined, skipping migrations");
    process.exit(0);
  }

  const migratorConfig = {
    migrationsFolder: resolve(__dirname, "../migrations"),
  };

  if (DB_URL.startsWith("memory://")) {
    const pglite = new PGlite(DB_URL, { extensions: { vector } });
    const drizzlePglite = devDrizzle({ client: pglite });
    console.log("Running migrations...");

    const start = Date.now();
    await devMigrate(drizzlePglite, migratorConfig);
    const end = Date.now();

    console.log("Migrations completed in", end - start, "ms");

    await pglite.close();
    process.exit(0);
  }

  const connection = postgres(DB_URL, { max: 1 });
  const db = prodDrizzle({ client: connection });

  console.log("Running migrations...");

  const start = Date.now();
  await prodMigrate(db, migratorConfig);
  await connection.unsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_embedding_hnsw_idx"
    ON "post" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL
  `);
  // Trigram support for the on-behalf people picker (docs/on-behalf.md).
  // Built outside the transactional migration pass so large contact tables
  // are never write-locked by index creation.
  await connection.unsafe(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm
  `);
  // A failed CONCURRENTLY build leaves an INVALID index behind, which
  // `IF NOT EXISTS` would then skip forever while the planner ignores it.
  // Drop such corpses so the creations below rebuild them concurrently.
  const trigramIndexes = [
    "contact_email_trgm_idx",
    "contact_name_trgm_idx",
    "company_name_trgm_idx",
  ] as const;
  for (const indexName of trigramIndexes) {
    const invalid = await connection.unsafe<
      Array<{ indisvalid: boolean; indisready: boolean }>
    >(
      `SELECT i.indisvalid, i.indisready
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = $1`,
      [indexName]
    );
    if (
      invalid[0] !== undefined &&
      (!invalid[0].indisvalid || !invalid[0].indisready)
    ) {
      console.warn(`Dropping invalid index ${indexName} for rebuild`);
      await connection.unsafe(
        `DROP INDEX CONCURRENTLY IF EXISTS "${indexName}"`
      );
    }
  }
  await connection.unsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "contact_email_trgm_idx"
    ON "contact" USING gin ("email" gin_trgm_ops)
  `);
  await connection.unsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "contact_name_trgm_idx"
    ON "contact" USING gin ("name" gin_trgm_ops)
  `);
  await connection.unsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "company_name_trgm_idx"
    ON "company" USING gin ("name" gin_trgm_ops)
  `);
  await connection.unsafe(`
    ALTER TABLE "post"
    VALIDATE CONSTRAINT "post_embedding_metadata_chk"
  `);
  const end = Date.now();

  console.log("Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("Migration failed");
  console.error(err);
  process.exit(1);
});
