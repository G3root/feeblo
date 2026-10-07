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
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type { SqlError } from "effect/sql/SqlError";

import { relations } from "./relations";

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
      Effect.promise(() => pglite.close()).pipe(
        Effect.timeoutOption("10 seconds"),
        Effect.tap((closed) =>
          Option.isNone(closed)
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

// Configure the Postgres client layer.
//
// `PgClient` owns the wire protocol as of rc.117 and no longer accepts `pg`
// type parsers, so the former `types` shim is gone. Timestamp columns now
// decode to `Date` rather than the raw strings that shim forced; the domain
// schemas read them through `Schema.Union([Schema.Date, Schema.DateFromString])`.
export const PgClientLive = SQLPG.PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
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
// PGlite & drizzle-orm/effect-pglite expose the same public API as the
// server-backed Postgres variants (Execute, execute, transaction, etc.), so
// the runtime object is compatible with `EffectPgDatabase`. Casting through
// `unknown` is safe as long as those two drizzle packages stay API-compatible;
// if they diverge (e.g. different `execute` return types), this will fail at
// runtime with no compile-time guard.
const pgliteDbEffect = PgDrizzlePglite.make({ relations }).pipe(
  Effect.tap(testConnection),
  // SAFETY: PgDrizzlePglite.make returns a fully-initialized EffectPgDatabase;
  // the cast bridges the driver-specific return type to the pg dialect type
  // used by the rest of the codebase.
  Effect.map((db) => db as PgDrizzle.EffectPgDatabase<typeof relations>)
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

// Backwards-compatible alias for the Postgres-only database layer.
export const DatabaseLive = PgDatabaseLive;

// Effect SQL keeps the active transaction connection in fiber-local context,
// so queries made through this database automatically join the current
// transaction (including queries from repositories that captured the database
// when their layer was built).
export const currentDb: Effect.Effect<
  PgDrizzle.EffectPgDatabase,
  never,
  Database
> = Database;

// Run an effect inside a database transaction. Effect SQL routes every query
// using this client's fiber-local transaction connection and turns nested
// calls into savepoints.
export function transaction<A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError, R | Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    return yield* db.transaction(() => effect);
  });
}
