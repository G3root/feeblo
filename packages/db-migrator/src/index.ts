import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
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
    const pglite = new PGlite(DB_URL);
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
  const end = Date.now();

  console.log("Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("Migration failed");
  console.error(err);
  process.exit(1);
});
