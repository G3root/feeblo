import { addEqualityTesters } from "@effect/vitest";
import { migratePglite } from "@feeblo/db/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

addEqualityTesters();

const databaseDirectory = await mkdtemp(join(tmpdir(), "feeblo-domain-"));
process.env.DATABASE_URL = `pglite:${databaseDirectory}`;

await migratePglite(process.env.DATABASE_URL);

afterAll(async () => {
  await rm(databaseDirectory, { force: true, recursive: true });
});
