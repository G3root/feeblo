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
 * Everything that changes the template's bytes: the schema, the source that
 * decides how the cluster is built, and the resolved dependency versions.
 *
 * `pglite.ts` owns the extension list, `database.ts` owns the client
 * configuration, and `migrations` owns the schema. The lockfile is in here
 * because none of those three change when `@electric-sql/pglite` is upgraded,
 * and a template written by an older PGlite is exactly the kind of stale cache
 * that fails as a confusing database error rather than as a missing directory.
 * Hashing the whole lockfile over-invalidates on an unrelated dependency bump,
 * which costs one 7s rebuild; being precise would mean resolving versions out of
 * a hoisted `node_modules`, which is the fragile half of the trade.
 */
const fingerprintInputs = [
  join(repositoryRoot, "packages/db/src/migrations"),
  join(repositoryRoot, "packages/db/src/pglite.ts"),
  join(repositoryRoot, "packages/db/src/database.ts"),
  join(repositoryRoot, "pnpm-lock.yaml"),
];

/**
 * How long a lock holder gets to publish before a waiter reaps the lock and
 * builds the template itself.
 *
 * A cold build is ~7s idle, so this is generous on purpose. It is also the
 * recovery time from a holder that was killed before it published, which is why
 * it is not larger - and why `ensureTemplate` reaps a lock that is older than
 * this rather than waiting on it forever.
 */
const templateWaitTimeoutMs = 60 * 1000;

/** How many times a waiter will wait out the timeout before reaping and building. */
const templateBuildAttempts = 2;

/**
 * How old an abandoned per-file database must be before it is pruned.
 *
 * Deliberately hours, not minutes. The check is the clone directory's own
 * `mtime`, and PGlite rewrites files that already exist without creating or
 * removing entries, so a clone that is being written to right now can have an
 * `mtime` from whenever it was created. A live test file holds its clone for
 * seconds to minutes, so two hours is orders of magnitude of headroom, while a
 * clone orphaned by a killed run is still reclaimed the next time tests run.
 * Deleting a live database mid-test is a far worse failure than leaving 43 MB in
 * `$TMPDIR` for an extra hour.
 */
const staleDatabaseAgeMs = 2 * 60 * 60 * 1000;

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
 * discards its own copy.
 */
const buildTemplate = async (templateDirectory: string): Promise<void> => {
  const stagingDirectory = await mkdtemp(join(templateCacheRoot, "staging-"));

  // Deliberately not in the catch below. A migration failure is never an
  // expected outcome, and folding it into a "publish lost the race" path would
  // report a broken schema as "the template was not built", which is the least
  // useful thing to tell the next person to hit it.
  try {
    await migratePglite(`pglite:${stagingDirectory}`);
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }

  try {
    await rename(stagingDirectory, templateDirectory);
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });

    // Losing the publish race is expected and silent. If the destination is
    // still missing then the publish failed for its own reason, and that error
    // is the only description of it anyone will get, so keep it.
    if (!(await pathExists(templateDirectory))) {
      throw error;
    }
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
  await mkdir(templateCacheRoot, { recursive: true });

  // The lock is an optimisation, not a correctness requirement: it stops five
  // packages from migrating the same schema at once. The publish `rename` is
  // what actually arbitrates, so the worst case for getting this wrong is a
  // duplicate migration rather than a corrupt template.
  const lockPath = `${templateDirectory}.lock`;

  for (let attempt = 0; attempt < templateBuildAttempts; attempt += 1) {
    if (await pathExists(templateDirectory)) {
      return templateDirectory;
    }

    // A holder that was killed before publishing leaves a lock behind, and
    // nothing else removes it. Without this, every later run would wait out the
    // timeout before building, which turns one interrupted run into a slow one
    // for the rest of the day.
    const lock = await stat(lockPath).catch(() => null);
    if (lock !== null && Date.now() - lock.mtimeMs > templateWaitTimeoutMs) {
      await rm(lockPath, { force: true });
    }

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
      break;
    }

    // Someone else is building it. Wait for the publish, and if it never comes,
    // go around again and reap what is now a stale lock.
    await waitForPath(templateDirectory, templateWaitTimeoutMs);
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
 * The age cutoff is what makes both sweeps safe, and it is generous for a
 * reason: see `staleDatabaseAgeMs`. A live database, staging directory, or lock
 * is minutes old in the worst case, so only an abandoned one can be past a
 * two-hour cutoff - including one belonging to a test run in a sibling
 * worktree, which shares this `$TMPDIR`. Locks are also reaped directly by
 * `ensureTemplate`, which cannot wait for this sweep to run.
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
