import { migratePglite } from "@feeblo/db/pglite";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

await migratePglite(databaseUrl);
console.log(`[e2e] Migrated PGlite database at ${databaseUrl}`);
