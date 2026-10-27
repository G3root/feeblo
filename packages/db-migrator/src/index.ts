import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle as devDrizzle } from "drizzle-orm/pglite";
import { migrate as devMigrate } from "drizzle-orm/pglite/migrator";
import { drizzle as prodDrizzle } from "drizzle-orm/postgres-js";
import { migrate as prodMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The advisory lock key that serializes migrators.
 *
 * Every server replica runs this script from its entrypoint, so two replicas
 * starting together would otherwise read the same applied-migration list and
 * both execute the same DDL. The second one would block on the first one's
 * locks and then fail on objects that already exist. A session-level advisory
 * lock makes the second wait instead, and its re-read of
 * `__drizzle_migrations` then finds nothing to apply.
 *
 * The value is arbitrary but must never change and must not collide with
 * another application in the same database; `72_246_14` is spelled out rather
 * than hashed so it is greppable.
 */
const migrationLockKey = 72_246_14;

/**
 * How long a migration statement may wait for a lock.
 *
 * Long enough that ordinary read traffic never fails a deploy, short enough
 * that a DDL statement stuck behind a long-running transaction fails the
 * migration instead of queueing. That distinction matters beyond the deploy
 * itself: a blocked `ALTER TABLE` holds a lock request that every later access
 * to the table queues behind, so an unbounded wait turns one slow query into a
 * frozen table.
 */
const migrationLockTimeout = "30s";

/**
 * How long to wait for another migrator before giving up.
 *
 * A batch of migrations can take minutes on a large database, and a replica
 * that starts during a deploy must wait for it rather than fail the rollout.
 */
const migrationLockWaitMs = 10 * 60 * 1000;

/**
 * Takes the migration lock, polling until it is free.
 *
 * `pg_try_advisory_lock` in a loop, not `pg_advisory_lock`: the blocking form
 * parks the backend inside one statement, and that statement holds a snapshot
 * for as long as it waits. `CREATE INDEX CONCURRENTLY` — which this script runs
 * after the migrations — refuses to finish while an older transaction is still
 * open, so a waiting migrator would keep the running one from ever completing,
 * and Postgres resolves the cycle by aborting the waiter with `40P01`. Polling
 * keeps every waiting statement short-lived, so there is no snapshot to wait
 * for.
 */
const acquireMigrationLock = async (connection: postgres.Sql) => {
  const deadline = Date.now() + migrationLockWaitMs;
  for (;;) {
    const [result] = await connection.unsafe<Array<{ locked: boolean }>>(
      `SELECT pg_try_advisory_lock(${migrationLockKey}) AS locked`
    );
    if (result?.locked === true) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${migrationLockWaitMs} ms waiting for another migrator to finish.`
      );
    }
    await sleep(1_000);
  }
};

/**
 * Builds one index concurrently, replacing it first if a previous attempt left
 * an invalid one behind.
 *
 * A failed `CREATE INDEX CONCURRENTLY` leaves an INVALID index that `IF NOT
 * EXISTS` then skips forever while the planner ignores it, so the check is what
 * makes the retry idempotent rather than permanently degraded.
 */
const buildIndexConcurrently = async (
  connection: postgres.Sql,
  indexName: string,
  createStatement: string
) => {
  const existing = await connection.unsafe<
    Array<{ indisready: boolean; indisvalid: boolean }>
  >(
    `SELECT i.indisvalid, i.indisready
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = $1`,
    [indexName]
  );
  const invalid = existing[0];
  if (invalid !== undefined && (!invalid.indisvalid || !invalid.indisready)) {
    console.warn(`Dropping invalid index ${indexName} for rebuild`);
    await connection.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${indexName}"`);
  }
  await connection.unsafe(createStatement);
};

/**
 * Indexes that must not be built inside the migration transaction.
 *
 * Drizzle applies every pending migration in one transaction, so a plain
 * `CREATE INDEX` here would hold a SHARE lock on the table until the last
 * migration of the batch committed — on `post` or `comment` that is a write
 * outage for the length of the deploy. Building them concurrently afterwards
 * means the table stays writable, and `IF NOT EXISTS` makes the pass a
 * catalog lookup once the index exists.
 *
 * The foreign-key indexes are here because an unindexed FK makes the parent
 * delete scan the child table: deleting a workspace, an account, or a comment
 * thread would otherwise scan `post`, `comment`, `upvote`, and
 * `post_subscription` while holding the row locks that delete depends on.
 */
const concurrentIndexes = [
  // Vector search (declared in `schema/feedback.ts` as part of `post`).
  [
    "post_embedding_hnsw_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_embedding_hnsw_idx"
     ON "post" USING hnsw ("embedding" vector_cosine_ops)
     WHERE "embedding" IS NOT NULL`,
  ],
  // Trigram support for the on-behalf people picker (docs/on-behalf.md).
  [
    "contact_email_trgm_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "contact_email_trgm_idx"
     ON "contact" USING gin ("email" gin_trgm_ops)`,
  ],
  [
    "contact_name_trgm_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "contact_name_trgm_idx"
     ON "contact" USING gin ("name" gin_trgm_ops)`,
  ],
  [
    "company_name_trgm_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "company_name_trgm_idx"
     ON "company" USING gin ("name" gin_trgm_ops)`,
  ],
  // Foreign-key indexes added in `20261020073319_rainy_adam_warlock`.
  [
    "invitation_inviterId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "invitation_inviterId_idx"
     ON "invitation" ("inviter_id")`,
  ],
  [
    "changelog_category_link_organizationId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "changelog_category_link_organizationId_idx"
     ON "changelog_category_link" ("organization_id")`,
  ],
  [
    "changelog_subscription_memberId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "changelog_subscription_memberId_idx"
     ON "changelog_subscription" ("member_id")`,
  ],
  [
    "commentReaction_memberId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "commentReaction_memberId_idx"
     ON "comment_reaction" ("member_id")`,
  ],
  [
    "comment_parentCommentId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "comment_parentCommentId_idx"
     ON "comment" ("parent_comment_id")`,
  ],
  [
    "comment_userId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "comment_userId_idx"
     ON "comment" ("user_id")`,
  ],
  [
    "comment_memberId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "comment_memberId_idx"
     ON "comment" ("member_id")`,
  ],
  [
    "notification_preference_userId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "notification_preference_userId_idx"
     ON "notification_preference" ("user_id")`,
  ],
  [
    "postReaction_memberId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "postReaction_memberId_idx"
     ON "post_reaction" ("member_id")`,
  ],
  [
    "post_subscription_memberId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_subscription_memberId_idx"
     ON "post_subscription" ("member_id")`,
  ],
  [
    "post_subscription_organizationId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_subscription_organizationId_idx"
     ON "post_subscription" ("organization_id")`,
  ],
  [
    "post_boardId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_boardId_idx"
     ON "post" ("board_id")`,
  ],
  [
    "post_creatorId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_creatorId_idx"
     ON "post" ("creator_id")`,
  ],
  [
    "post_creatorMemberId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_creatorMemberId_idx"
     ON "post" ("creator_member_id")`,
  ],
  [
    "post_tag_organizationId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_tag_organizationId_idx"
     ON "post_tag" ("organization_id")`,
  ],
  [
    "upvote_memberId_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "upvote_memberId_idx"
     ON "upvote" ("member_id")`,
  ],
  // The monthly volume guard's count, run on every email send attempt. The
  // predicate is the guard's own: a delivery the provider never accepted cannot
  // spend an allowance, so the index holds only rows a count can match.
  [
    "email_delivery_acceptedAt_idx",
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_delivery_acceptedAt_idx"
     ON "email_delivery" ("accepted_at") WHERE "accepted_at" is not null`,
  ],
] as const;

const runMigrate = async () => {
  const DB_URL = process.env.DATABASE_URL;
  if (!DB_URL) {
    console.log("DATABASE_URL not defined, skipping migrations");
    process.exit(0);
  }

  // `../migrations` is the layout the server image builds: `dist` is copied to
  // `/app/migrate` and `packages/db/src/migrations` to `/app/migrations`, so the
  // migrations sit beside the bundle. Nothing inside this package ever held a
  // `migrations` folder, so a run from a checkout has to name one — that is what
  // `MIGRATIONS_DIR` is for. It is resolved against the working directory, which
  // is this package under `pnpm --filter`.
  const migratorConfig = {
    migrationsFolder:
      process.env.MIGRATIONS_DIR === undefined
        ? resolve(__dirname, "../migrations")
        : resolve(process.env.MIGRATIONS_DIR),
  };

  if (DB_URL.startsWith("memory://")) {
    const pglite = new PGlite(DB_URL, { extensions: { vector } });
    const drizzlePglite = devDrizzle({ client: pglite });
    console.log("Running migrations...");

    const start = Date.now();
    await devMigrate(drizzlePglite, migratorConfig);
    const end = Date.now();

    console.log("Migrations completed in", end - start, "ms");

    await pglite.close();
    process.exit(0);
  }

  // `max: 1` matters here, not just for tidiness: the advisory lock below is
  // session-scoped, and a pooled migrator could take it on one connection and
  // run the migrations on another. `max_lifetime: null` matters for the same
  // reason: postgres.js retires a connection after a random 30–60 minutes by
  // default, and a recycled connection takes the advisory lock and the
  // `lock_timeout` below with it — a long batch would keep running without
  // either. Idle recycling needs no override; it is already off by default.
  const connection = postgres(DB_URL, { max: 1, max_lifetime: null });
  const db = prodDrizzle({ client: connection });

  await connection.unsafe(`SET lock_timeout = '${migrationLockTimeout}'`);

  console.log("Waiting for the migration lock...");
  await acquireMigrationLock(connection);

  try {
    console.log("Running migrations...");
    const start = Date.now();

    await prodMigrate(db, migratorConfig);

    // Concurrent index builds wait as long as the table needs. Autovacuum holds
    // `ShareUpdateExclusiveLock` for as long as it runs, and that wait conflicts
    // with a concurrent build — but it does not block ordinary reads or writes,
    // and the migration lock already keeps a second migrator out, so a deadline
    // here would abort a legitimate build rather than protect anything. It is
    // also the more expensive outcome: a failed concurrent build leaves an
    // invalid index behind and costs a rebuild.
    await connection.unsafe(`SET lock_timeout = 0`);
    await connection.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    for (const [indexName, createStatement] of concurrentIndexes) {
      await buildIndexConcurrently(connection, indexName, createStatement);
    }

    // Back to the deadline for the remaining DDL: a validation stuck behind a
    // long transaction should fail the deploy, and unlike a concurrent build it
    // leaves nothing half-built when it does.
    await connection.unsafe(`SET lock_timeout = '${migrationLockTimeout}'`);
    await connection.unsafe(`
      ALTER TABLE "post"
      VALIDATE CONSTRAINT "post_embedding_metadata_chk"
    `);

    const end = Date.now();
    console.log("Migrations completed in", end - start, "ms");
  } finally {
    // Unlocked explicitly so a later step in the same container is not waiting
    // on a lock the process no longer needs; a crash releases it with the
    // session anyway.
    await connection
      .unsafe(`SELECT pg_advisory_unlock(${migrationLockKey})`)
      .catch(() => undefined);
    await connection.end();
  }

  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("Migration failed");
  console.error(err);
  process.exit(1);
});
