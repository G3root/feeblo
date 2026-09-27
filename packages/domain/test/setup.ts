import { constants } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addEqualityTesters } from "@effect/vitest";
import { afterAll } from "vitest";

addEqualityTesters();

const databaseTemplateDirectory =
  process.env.FEEBLO_DOMAIN_TEST_DATABASE_TEMPLATE;

if (!databaseTemplateDirectory) {
  throw new Error("Domain test database template has not been initialized");
}

/**
 * One private cluster per test file, cloned from the shared template.
 *
 * The clone is the isolation mechanism: a test file gets a schema that matches
 * the migrations and a database no other file has written to, without paying to
 * run the migrations again (in-memory PGlite plus `migratePglite` measured 3.9s
 * against ~0.3s for the clone).
 *
 * It is also the most expensive thing the domain suite does, and the cost is per
 * *inode*, not per byte: the template is 1370 files, so the clone is roughly
 * linear in file count rather than in the size of the data a test touches.
 * Measured as interleaved medians, one clone costs ~0.27s on an idle machine and
 * ~3.4s while the other eighteen suites in `turbo run test` are competing for
 * the same disk - which is why `vitest-preset.ts` raises the timeout rather than
 * letting a busy machine look like a broken test. Anything that adds 200 tables
 * adds that cost to all 70 of these.
 */
const databaseDirectory = await mkdtemp(join(tmpdir(), "feeblo-domain-"));

await cp(databaseTemplateDirectory, databaseDirectory, {
  mode: constants.COPYFILE_FICLONE,
  recursive: true,
});
process.env.DATABASE_URL = `pglite:${databaseDirectory}`;

afterAll(async () => {
  await rm(databaseDirectory, { force: true, recursive: true });
});
