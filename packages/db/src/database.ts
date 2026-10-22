import * as SQLPG from "@effect/sql-pg";
import { PgliteClient } from "@effect/sql-pglite";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { sql } from "drizzle-orm";
import * as PgDrizzlePglite from "drizzle-orm/effect-pglite";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type { SqlError } from "effect/sql/SqlError";

import { relations } from "./relations";
import { withTransactionAbortRetry } from "./transaction-abort";

// Detect whether the configured DATABASE_URL points at an embedded PGlite
// instance (`pglite:/path/...`) instead of a real PostgreSQL server.
const isPgliteUrl = (url: string): boolean => url.startsWith("pglite:");

// We support `pglite:<path>` as a test-friendly way to point
// at a file-backed PGlite database while still selecting the PGlite client.
const pgliteDataDir = (url: string): string => {
  if (url.startsWith("pglite:")) {
    return url.slice("pglite:".length);
  }
  return url;
};

/** How long PGlite gets to close before the release gives up waiting. */
const pgliteCloseTimeoutMs = 10_000;

/**
 * Resolves when `close` settles or the deadline passes, whichever is first.
 *
 * The race is wall-clock on purpose. `Effect.timeoutOption` reads the fiber's
 * `Clock`, so a scope closing under `TestClock` would wait for virtual time
 * that never advances, and a finalizer cannot rely on interrupting a close
 * that is already past interruption.
 */
const closeWithinDeadline = (
  close: Promise<void>
): Promise<"closed" | "timed-out"> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timed-out"), pgliteCloseTimeoutMs);
    close.then(
      () => {
        clearTimeout(timer);
        resolve("closed");
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      }
    );
  });

// Configure the PGlite client layer. PGlite accepts the same `memory://`
// data-directory URL the reference implementation passes straight through.
//
// The close is bounded because PGlite runs in-process: a close that waits on a
// wedged WASM mutex would otherwise hang layer teardown — and the test worker
// with it — forever. Ten seconds is far longer than a healthy close, and a
// timeout is logged rather than thrown so it cannot fail a passing test.
export const PgliteClientLive = PgliteClient.layerFrom(
  Effect.acquireRelease(
    Effect.map(
      Config.String("DATABASE_URL"),
      (url) =>
        new PGlite(pgliteDataDir(url), {
          extensions: { vector, pg_trgm },
        })
    ),
    (pglite) =>
      Effect.promise(() => closeWithinDeadline(pglite.close())).pipe(
        Effect.tap((outcome) =>
          outcome === "timed-out"
            ? Effect.logWarning(
                "[Database client]: PGlite did not close within 10 seconds; the process may be wedged."
              )
            : Effect.void
        )
      )
  ).pipe(
    Effect.flatMap((liveClient) => PgliteClient.fromClient({ liveClient }))
  )
);

/**
 * How long a statement may wait for a row lock before Postgres aborts it.
 *
 * Without a deadline a waiter holds its pooled connection indefinitely. The
 * pool is ten connections per process, and the write paths serialize per
 * workspace on the organization row, so ten blocked requests would starve
 * every other tenant of the same process — a lock wait on one workspace
 * becoming an outage on all of them. The value is longer than any healthy
 * write transaction (the longest is a post create with notification fan-out)
 * and short enough that a request fails instead of hanging.
 */
const lockTimeout = "5s";

/**
 * How long a transaction may sit idle — open, holding its locks, running no
 * statement — before Postgres terminates it.
 *
 * A leaked transaction is the one leak a pooling client cannot recover from on
 * its own: the connection stays checked out and its row locks stay held, so
 * every other writer queues behind a fiber that may never resume.
 */
const idleInTransactionTimeout = "30s";

// Configure the Postgres client layer.
//
// `PgClient` owns the wire protocol as of rc.117 and no longer accepts `pg`
// type parsers, so the former `types` shim is gone. Timestamp columns now
// decode to `Date` rather than the raw strings that shim forced; the domain
// schemas read them through `Schema.Union([Schema.Date, Schema.DateFromString])`.
//
// The two timeouts travel in the startup packet, so every pooled connection
// carries them and no caller has to remember to set them per transaction.
// `lock_timeout` surfaces as SQLSTATE `55P03`, which `withTransactionAbortRetry`
// retries and `withRemapDbErrors` turns into a 500 once the retries run out —
// far better than a request that never returns.
export const PgClientLive = SQLPG.PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
  startupParameters: {
    idle_in_transaction_session_timeout: Config.succeed(
      idleInTransactionTimeout
    ),
    lock_timeout: Config.succeed(lockTimeout),
  },
});

/** Connection health-check that retries with jittered backoff on startup. */
const testConnection = (db: PgDrizzle.EffectPgDatabase) =>
  db.execute(sql`SELECT 1`).pipe(
    Effect.retry(
      Schedule.jittered(Schedule.spaced("1.25 seconds")).pipe(
        Schedule.upTo({ times: 10 }),
        Schedule.tap(({ attempt }) =>
          Effect.logWarning(
            `[Database client]: Connection to the database failed. Retrying (attempt ${attempt}).`
          )
        )
      )
    ),
    Effect.tap(() =>
      Effect.logInfo(
        "[Database client]: Connection to the database established."
      )
    ),
    Effect.orDie
  );

// Create the DB effect with default services for a Postgres server.
const pgDbEffect = PgDrizzle.make({ relations }).pipe(
  Effect.tap(testConnection)
);

// Create the DB effect for an embedded PGlite instance.
const pgliteDbEffect = PgDrizzlePglite.make({ relations }).pipe(
  // SAFETY: `PgDrizzlePglite.make` returns a fully-initialized database whose
  // runtime surface is the Postgres driver's — the same `select`, `insert`,
  // `transaction` and `execute`, over the same Effect SQL client. Only the
  // *declared* result of a statement differs: Postgres', through
  // `@effect/sql-pg`, reports `oid` plus a mandatory `command` and `rowCount`,
  // while PGlite's `Results` makes those optional and has no `oid` to report
  // because an embedded database has no server catalog to name. That difference
  // is unavoidable at the type level — it is inside the builder generics, so a
  // `Pick`/`Omit` of the divergent members would not make the two databases
  // comparable — and it is invisible at runtime, where nothing in the tree
  // reads `oid`, `command` or `rowCount` off an `execute` result: `execute` is
  // used for statements whose effect is the point, such as a row lock.
  // The intermediate `unknown` is what lets the assertion pass the compiler's
  // overlap check (TS2352 rejects the single-step cast).
  Effect.map(
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- See the SAFETY comment: the drivers' database types are irreconcilable at TS2352 and identical at runtime, so this boundary is the one place the difference is erased.
    (db) => db as unknown as PgDrizzle.EffectPgDatabase<typeof relations>
  ),
  Effect.tap(testConnection)
);

// Define a DB service tag for dependency injection
export class Database extends Context.Service<
  Database,
  PgDrizzle.EffectPgDatabase<typeof relations>
>()("@feeblo/Database") {}

// Postgres-backed layers
export const PgDatabaseLive = Layer.effect(Database, pgDbEffect).pipe(
  Layer.provide(PgClientLive),
  Layer.provide(PgDrizzle.DefaultServices)
);

// PGlite-backed layers
export const PgliteDatabaseLive = Layer.effect(Database, pgliteDbEffect).pipe(
  Layer.provide(PgliteClientLive),
  Layer.provide(PgDrizzlePglite.DefaultServices)
);

// Pick the appropriate database layer based on the configured DATABASE_URL.
// `memory://` URLs (and any other PGlite-style data directory) use the
// embedded PGlite client; everything else assumes a real Postgres server.
export const DatabaseContextLive = Layer.unwrap(
  Effect.map(Config.String("DATABASE_URL"), (url) =>
    isPgliteUrl(url) ? PgliteDatabaseLive : PgDatabaseLive
  )
);

/**
 * Effect SQL client backing the durable stores that need raw SQL access,
 * currently the cluster workflow engine's message storage.
 */
export const SqlClientContextLive = Layer.unwrap(
  Effect.map(Config.String("DATABASE_URL"), (url) =>
    isPgliteUrl(url) ? PgliteClientLive : PgClientLive
  )
);

/**
 * Backwards-compatible alias for the Postgres-only database layer.
 *
 * @alias
 */
export const DatabaseLive = PgDatabaseLive;

/**
 * Effect SQL keeps the active transaction connection in fiber-local context,
 * so queries made through this database automatically join the current
 * transaction (including queries from repositories that captured the database
 * when their layer was built).
 *
 * @alias
 */
export const currentDb: Effect.Effect<
  PgDrizzle.EffectPgDatabase,
  never,
  Database
> = Database;

// Run an effect inside a database transaction. Effect SQL routes every query
// using this client's fiber-local transaction connection and turns nested
// calls into savepoints.
//
// The retry re-runs the whole transaction, which is the only recovery for a
// deadlock or a lock timeout: Postgres has already rolled it back, so nothing
// from the first attempt is visible to the second. Repositories that call
// `db.transaction` directly instead of this helper should wrap the call in
// `withTransactionAbortRetry` for the same reason.
export function transaction<A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError, R | Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    return yield* db.transaction(() => effect);
  }).pipe(withTransactionAbortRetry);
}
