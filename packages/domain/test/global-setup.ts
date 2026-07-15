import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratePglite } from "@feeblo/db/pglite";

const databaseTemplateEnvironmentVariable =
  "FEEBLO_DOMAIN_TEST_DATABASE_TEMPLATE";

export default async function setup(): Promise<() => Promise<void>> {
  const databaseTemplateDirectory = await mkdtemp(
    join(tmpdir(), "feeblo-domain-template-")
  );

  await migratePglite(`pglite:${databaseTemplateDirectory}`);
  process.env[databaseTemplateEnvironmentVariable] = databaseTemplateDirectory;

  return async () => {
    delete process.env[databaseTemplateEnvironmentVariable];
    await rm(databaseTemplateDirectory, { force: true, recursive: true });
  };
}
