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
 * How long a waiter waits for a peer's build before trying again.
 *
 * A cold build is ~7s with the machine to itself, but this is not a deadline:
 * when the budget runs out `ensureTemplate` builds the template itself. It only
 * decides how much duplicate work happens, never whether a suite can run.
 */
const templateWaitTimeoutMs = 60 * 1000;

/** How many times a waiter yields to a peer before building the template itself. */
const templateBuildAttempts = 2;

/**
 * How old a lock must be before the sweep may remove it.
 *
 * Far longer than any build, and that gap is the point: it is what makes the
 * sweep unable to remove a lock someone is still holding, and therefore what
 * makes the holder's own release safe. It sits between a lock's real lifetime
 * (seconds) and `staleDatabaseAgeMs` (hours) because a lock is abandoned after
 * a build, not after a test run.
 */
const lockAbandonedAfterMs = 10 * 60 * 1000;

/** The suffix that separates a lock in the cache from a cached template. */
const lockSuffix = ".lock";

/** Every per-file clone in `$TMPDIR` is named with this prefix. */
const clonePrefix = "feeblo-domain-";

/**
 * The process that owns a per-file clone, read from the name `setup.ts` gives it.
 * `null` for a clone created before the name carried a pid.
 */
const cloneOwnerPid = (name: string): number | null => {
  const owner = /^feeblo-domain-(\d+)-/.exec(name);
  return owner === null ? null : Number(owner[1]);
};

/**
 * Whether the process that created a clone has exited.
 *
 * `process.kill(pid, 0)` sends no signal - it only asks whether the pid exists.
 * A pid that an unrelated process has since reused reads as alive, which skips
 * the removal, and skipping is the safe direction. The only other way this can
 * fail is `EPERM` for a pid owned by another user, which cannot happen for a
 * clone in our own `$TMPDIR`, so treating every failure as "gone" is correct
 * here.
 *
 * This exists because a clone directory's `mtime` is not a liveness signal.
 * PGlite rewrites files that already exist without creating or removing entries,
 * so the directory keeps the `mtime` it was born with for the whole run, and
 * only the run's own `afterAll` - which a killed process never reaches - can
 * distinguish an in-flight test file from a leaked one.
 */
const ownerHasExited = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

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

/**
 * Claims the lock, returning the inode that identifies it, or `null` when a peer
 * already holds it. Nothing distinguishes the reasons `open` can fail, because
 * every one of them already means "use whatever is at `templateDirectory`".
 */
const tryClaimLock = async (lockPath: string): Promise<number | null> =>
  open(lockPath, "wx").then(
    async (handle) => {
      const claimed = await handle.stat();
      await handle.close();
      return claimed.ino;
    },
    () => null
  );

/**
 * Removes the lock only if it is still the file this process created.
 *
 * A successor can only take this lock's place if something removed it first, and
 * the only thing that removes a lock is the sweep, which needs a build longer
 * than `lockAbandonedAfterMs`. Comparing inodes means that even then this cannot
 * delete a lock it does not own - which is the mistake that would let two
 * builders run at once.
 */
const releaseLock = async (
  lockPath: string,
  lockInode: number
): Promise<void> => {
  const current = await stat(lockPath).catch(() => null);

  if (current === null || current.ino !== lockInode) {
    return;
  }

  await rm(lockPath, { force: true });
};

const ensureTemplate = async (templateDirectory: string): Promise<string> => {
  await mkdir(templateCacheRoot, { recursive: true });

  // The lock is an optimisation, not a correctness requirement: it stops five
  // packages from migrating the same schema at once. The publish `rename` is
  // what actually arbitrates, so a duplicate migration is possible but a corrupt
  // template is not. Nothing here deletes a peer's lock, and nothing waits
  // forever: a lock that outlives its holder costs waiters one timeout, and then
  // they build the template themselves.
  const lockPath = `${templateDirectory}${lockSuffix}`;

  for (let attempt = 0; attempt < templateBuildAttempts; attempt += 1) {
    if (await pathExists(templateDirectory)) {
      return templateDirectory;
    }

    const lockInode = await tryClaimLock(lockPath);
    if (lockInode !== null) {
      try {
        await buildTemplate(templateDirectory);
      } finally {
        await releaseLock(lockPath, lockInode);
      }
      return templateDirectory;
    }

    if (await waitForPath(templateDirectory, templateWaitTimeoutMs)) {
      return templateDirectory;
    }
  }

  // A peer held the lock for the whole budget and never published. Build it here
  // rather than failing: the holder may be alive and merely starved, and then the
  // publish `rename` decides which of us wins. Failing instead would take down
  // this package's entire suite over a template another process is still
  // writing, and report it as "the template was not built", which is the least
  // useful thing to say about it.
  await buildTemplate(templateDirectory);

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
 * How old a file must be before it is removed.
 *
 * Clones whose process has exited are the exception and are reclaimed
 * immediately - see below - so `staleDatabaseAgeMs` only has to cover a live
 * clone from before this naming scheme, a live `staging-` directory, a
 * superseded template, or a lock whose holder is still working. The gap between
 * a live file's lifetime and the cutoff it is measured against is what keeps the
 * stat-then-remove below from hitting something in use.
 *
 * Locks get `lockAbandonedAfterMs` instead, because they are abandoned after a
 * build rather than after a test run.
 *
 * Best effort on purpose: this is deferred hygiene, so a permissions problem or
 * a directory that a concurrent package removed first must not turn into a test
 * failure.
 */
const pruneAbandonedDatabases = async (
  currentTemplateDirectory: string
): Promise<void> => {
  const now = Date.now();
  const candidates: { path: string; removableBefore: number }[] = [];

  const cloneEntries = await readdir(tmpdir(), { withFileTypes: true }).then(
    (entries) =>
      entries.filter(
        (entry) => entry.isDirectory() && entry.name.startsWith(clonePrefix)
      ),
    () => []
  );

  for (const entry of cloneEntries) {
    const owner = cloneOwnerPid(entry.name);

    // A clone whose run is still alive is not a candidate at all, however old
    // its directory looks - see `ownerHasExited`.
    if (owner !== null && !ownerHasExited(owner)) {
      continue;
    }

    candidates.push({
      path: join(tmpdir(), entry.name),
      // An orphaned clone is reclaimable now rather than in two hours: the
      // `afterAll` that removes it belonged to a process that has exited, so
      // nothing is coming for it. A clone from before the name carried a pid has
      // no owner to check and falls back to the age cutoff.
      removableBefore: owner === null ? now - staleDatabaseAgeMs : now,
    });
  }

  const cacheEntries = await readdir(templateCacheRoot, {
    withFileTypes: true,
  }).then(
    (entries) => entries.map((entry) => join(templateCacheRoot, entry.name)),
    () => []
  );

  for (const path of cacheEntries) {
    if (path === currentTemplateDirectory) {
      continue;
    }

    candidates.push({
      path,
      removableBefore:
        now -
        (path.endsWith(lockSuffix) ? lockAbandonedAfterMs : staleDatabaseAgeMs),
    });
  }

  await Promise.all(
    candidates.map(async ({ path, removableBefore }) => {
      const info = await stat(path).catch(() => null);
      if (info !== null && info.mtimeMs < removableBefore) {
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
