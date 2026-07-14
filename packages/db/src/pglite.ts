import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const dataDirectory = (databaseUrl: string): string =>
  databaseUrl.startsWith("pglite:")
    ? databaseUrl.slice("pglite:".length)
    : databaseUrl;

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

/**
 * Applies this package's migrations to a PGlite database.
 *
 * Both end-to-end and package tests use this entry point so their schema
 * lifecycle cannot drift from one another.
 */
export const migratePglite = async (databaseUrl: string): Promise<void> => {
  const dataDir = dataDirectory(databaseUrl);
  await mkdir(dataDir, { recursive: true });

  const pglite = new PGlite(dataDir);
  const db = drizzle({ client: pglite });

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pglite.close();
  }
};
