import { createHash, type Hash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { migratePglite } from "@feeblo/db/pglite";

const databaseTemplateEnvironmentVariable =
  "FEEBLO_DOMAIN_TEST_DATABASE_TEMPLATE";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/**
 * The migrated cluster is built once and reused until the migrations or the
 * PGlite client change.
 *
 * Six packages run this setup: `@feeblo/domain` and the five integrations. It
 * used to migrate its own cluster into a fresh `$TMPDIR` directory every time,
 * which meant six `migratePglite` runs and six 43 MB clusters per test run, and
 * a template left behind in `$TMPDIR` whenever a run was interrupted. Keying a
 * single cache by content under the repo's gitignored `.cache/` makes the
 * rebuild conditional instead of unconditional, and the path stable instead of
 * new-per-run.
 */
const templateCacheRoot = join(repositoryRoot, ".cache", "test-db-template");

/**
 * Everything that changes the template's bytes. `pglite.ts` owns the extension
 * list, `database.ts` owns the client configuration, and `migrations` owns the
 * schema. A change to any of them has to miss the cache, or a stale template
 * would silently answer for a schema that no longer exists.
 */
const fingerprintInputs = [
  join(repositoryRoot, "packages/db/src/migrations"),
  join(repositoryRoot, "packages/db/src/pglite.ts"),
  join(repositoryRoot, "packages/db/src/database.ts"),
];

/** How long a lock holder gets before the waiter builds the template itself. */
const templateWaitTimeoutMs = 5 * 60 * 1000;

/**
 * How old an abandoned per-file database must be before it is pruned. A test
 * file's database is minutes old at most, so anything past this belongs to a
 * killed run rather than a live one - including runs from the sibling worktrees
 * that share this `$TMPDIR`.
 */
const staleDatabaseAgeMs = 30 * 60 * 1000;

const pathExists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  );

const hashPath = async (path: string, hash: Hash): Promise<void> => {
  const info = await stat(path);

  if (info.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) {
      await hashPath(join(path, entry), hash);
    }
    return;
  }

  hash.update(relative(repositoryRoot, path));
  hash.update(await readFile(path));
};

const fingerprintTemplateInputs = async (): Promise<string> => {
  const hash = createHash("sha256");

  for (const path of fingerprintInputs) {
    await hashPath(path, hash);
  }

  return hash.digest("hex").slice(0, 16);
};

/**
 * Builds the template where nobody can see it yet, then publishes it with a
 * `rename`. `rename` refuses a non-empty destination, so two packages racing to
 * build the same fingerprint resolve to exactly one winner and the loser
 * discards its own copy. Nothing here inspects an errno: losing the race and
 * failing to write are both "use whatever is at `templateDirectory`", and the
 * caller checks that afterwards.
 */
const buildTemplate = async (templateDirectory: string): Promise<void> => {
  const stagingDirectory = await mkdtemp(join(templateCacheRoot, "staging-"));

  try {
    await migratePglite(`pglite:${stagingDirectory}`);
    await rename(stagingDirectory, templateDirectory);
  } catch {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

const waitForPath = async (
  path: string,
  timeoutMs: number
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await pathExists(path)) {
      return true;
    }
    await delay(250);
  }

  return false;
};

const ensureTemplate = async (templateDirectory: string): Promise<string> => {
  if (await pathExists(templateDirectory)) {
    return templateDirectory;
  }

  await mkdir(templateCacheRoot, { recursive: true });

  // The lock is an optimisation, not a correctness requirement: it stops five
  // packages from migrating the same schema at once. A holder that dies without
  // releasing it costs the waiters a timeout, and the fallback build below
  // recovers from that, so there is no stale-lock reaping to get wrong.
  const lockPath = `${templateDirectory}.lock`;
  const claimedLock = await open(lockPath, "wx").then(
    async (handle) => {
      await handle.close();
      return true;
    },
    () => false
  );

  if (claimedLock) {
    try {
      await buildTemplate(templateDirectory);
    } finally {
      await rm(lockPath, { force: true });
    }
  } else if (!(await waitForPath(templateDirectory, templateWaitTimeoutMs))) {
    await buildTemplate(templateDirectory);
  }

  if (!(await pathExists(templateDirectory))) {
    throw new Error(
      `Failed to build the PGlite test template at ${templateDirectory}`
    );
  }

  return templateDirectory;
};

/**
 * Removes per-file databases that a killed run left behind, and everything in
 * the template cache except the fingerprint in use.
 *
 * `setup.ts` copies a cluster per test file and deletes it in `afterAll`. A
 * `SIGINT`, a turbo abort, or a timed-out worker skips that hook, and the
 * leftovers are 25-43 MB each - a few interrupted runs are hundreds of
 * megabytes of `$TMPDIR` on a machine that is already the constraint. The cache
 * sweep is the same problem one level up: a `staging-` directory from a build
 * that died, a `*.lock` from a holder that died, or a whole template from a
 * migration set that has since changed.
 *
 * The age cutoff is what makes both sweeps safe. A live database, staging
 * directory, or lock is seconds old, so only an abandoned one can be past the
 * cutoff - including one belonging to a test run in a sibling worktree, which
 * shares this `$TMPDIR`.
 *
 * Best effort on purpose: this is deferred hygiene, so a permissions problem or
 * a directory that a concurrent package removed first must not turn into a test
 * failure.
 */
const pruneAbandonedDatabases = async (
  currentTemplateDirectory: string
): Promise<void> => {
  const cutoff = Date.now() - staleDatabaseAgeMs;

  const abandoned = await readdir(tmpdir(), { withFileTypes: true }).then(
    (entries) =>
      entries
        .filter(
          (entry) =>
            entry.isDirectory() && entry.name.startsWith("feeblo-domain-")
        )
        .map((entry) => join(tmpdir(), entry.name)),
    () => []
  );

  const superseded = await readdir(templateCacheRoot, {
    withFileTypes: true,
  }).then(
    (entries) =>
      entries
        .map((entry) => join(templateCacheRoot, entry.name))
        .filter((path) => path !== currentTemplateDirectory),
    () => []
  );

  await Promise.all(
    [...abandoned, ...superseded].map(async (path) => {
      const info = await stat(path).catch(() => null);
      if (info !== null && info.mtimeMs < cutoff) {
        await rm(path, { force: true, recursive: true }).catch(() => undefined);
      }
    })
  );
};

export default async function setup(): Promise<() => Promise<void>> {
  const templateDirectory = await ensureTemplate(
    join(templateCacheRoot, await fingerprintTemplateInputs())
  );

  await pruneAbandonedDatabases(templateDirectory);

  process.env[databaseTemplateEnvironmentVariable] = templateDirectory;

  return async () => {
    delete process.env[databaseTemplateEnvironmentVariable];
  };
}
