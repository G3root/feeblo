import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
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
 * Indexes the migrator builds with `CREATE INDEX CONCURRENTLY` after its
 * transactional pass (`packages/db-migrator/src/index.ts`), replayed here so a
 * PGlite schema still carries them.
 *
 * Only the volume guard's index is listed. It was added after the migrator
 * grew its concurrent pass, so its migration is a no-op comment and nothing
 * else would create it for a test database. The entries that predate that pass
 * stay absent here on purpose: replaying all of them would slow every test
 * database build and none of them is load-bearing for a test.
 */
const concurrentIndexStatements = [
  `CREATE INDEX IF NOT EXISTS "email_delivery_acceptedAt_idx"
   ON "email_delivery" ("accepted_at") WHERE "accepted_at" is not null`,
] as const;

/**
 * Applies this package's migrations to a PGlite database.
 *
 * Both end-to-end and package tests use this entry point so their schema
 * lifecycle cannot drift from one another.
 */
export const migratePglite = async (databaseUrl: string): Promise<void> => {
  const dataDir = dataDirectory(databaseUrl);
  await mkdir(dataDir, { recursive: true });

  const pglite = new PGlite(dataDir, { extensions: { vector, pg_trgm } });
  const db = drizzle({ client: pglite });

  try {
    await migrate(db, { migrationsFolder });
    for (const statement of concurrentIndexStatements) {
      await pglite.exec(statement);
    }
  } finally {
    await pglite.close();
  }
};
