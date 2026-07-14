import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const dataDir = databaseUrl.startsWith("pglite:")
  ? databaseUrl.slice("pglite:".length)
  : databaseUrl;

const pglite = new PGlite(dataDir);
const db = drizzle({ client: pglite });

await migrate(db, {
  migrationsFolder: path.resolve(
    import.meta.dirname,
    "../../packages/db/src/migrations"
  ),
});

await pglite.close();
console.log(`[e2e] Migrated PGlite database at ${dataDir}`);
