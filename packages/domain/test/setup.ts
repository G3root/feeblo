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

const databaseDirectory = await mkdtemp(join(tmpdir(), "feeblo-domain-"));

await cp(databaseTemplateDirectory, databaseDirectory, {
  mode: constants.COPYFILE_FICLONE,
  recursive: true,
});
process.env.DATABASE_URL = `pglite:${databaseDirectory}`;

afterAll(async () => {
  await rm(databaseDirectory, { force: true, recursive: true });
});
