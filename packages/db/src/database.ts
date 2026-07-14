import * as SQLPG from "@effect/sql-pg";
import { PgliteClient } from "@effect/sql-pglite";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import * as PgDrizzlePglite from "drizzle-orm/effect-pglite";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { type CustomTypesConfig, types } from "pg";
import { relations } from "./relations";

const pgTypes: CustomTypesConfig = {
  getTypeParser: (typeId, format) => {
    if (
      [1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182].includes(typeId)
    ) {
      return (value: string) => value;
    }

    return types.getTypeParser(typeId, format);
  },
};

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
export const PgliteClientLive = PgliteClient.layerFrom(
  Effect.acquireRelease(
    Effect.map(Config.string("DATABASE_URL"), (url) =>
      new PGlite(pgliteDataDir(url))
    ),
    (pglite) => Effect.promise(() => pglite.close())
  ).pipe(
    Effect.flatMap((liveClient) => PgliteClient.fromClient({ liveClient }))
  )
);

// Configure the Postgres client layer.
export const PgClientLive = SQLPG.PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  types: Config.succeed(pgTypes),
});

/** Connection health-check that retries with jittered backoff on startup. */
const testConnection = (db: PgDrizzle.EffectPgDatabase) =>
  db.execute(sql`SELECT 1`).pipe(
    Effect.retry(
      Schedule.jittered(Schedule.spaced("1.25 seconds")).pipe(
        Schedule.both(Schedule.recurs(10)),
        Schedule.tapOutput(([output]) =>
          Effect.logWarning(
            `[Database client]: Connection to the database failed. Retrying (attempt ${output}).`
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
  Effect.provide(PgDrizzle.DefaultServices),
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
  Effect.provide(PgDrizzlePglite.DefaultServices),
  Effect.tap(testConnection),
  Effect.map((db) => db as unknown as PgDrizzle.EffectPgDatabase)
);

// Define a DB service tag for dependency injection
export class Database extends Context.Service<
  Database,
  PgDrizzle.EffectPgDatabase
>()("@feeblo/Database") {}

// Postgres-backed layers
export const PgDatabaseLive = Layer.effect(Database, pgDbEffect).pipe(
  Layer.provide(PgClientLive)
);

// PGlite-backed layers
export const PgliteDatabaseLive = Layer.effect(Database, pgliteDbEffect).pipe(
  Layer.provide(PgliteClientLive)
);

// Pick the appropriate database layer based on the configured DATABASE_URL.
// `memory://` URLs (and any other PGlite-style data directory) use the
// embedded PGlite client; everything else assumes a real Postgres server.
export const DatabaseContextLive = Layer.unwrap(
  Effect.map(Config.string("DATABASE_URL"), (url) =>
    isPgliteUrl(url) ? PgliteDatabaseLive : PgDatabaseLive
  )
);

// Backwards-compatible alias for the Postgres-only database layer.
export const DatabaseLive = PgDatabaseLive;

// Tracks the active transaction client so repository methods automatically
// run on the current transaction when one is in progress.
export interface TransactionService {
  readonly db: PgDrizzle.EffectPgDatabase;
}

/**
 * @effect-leakable-service
 */
export class TransactionContext extends Context.Service<
  TransactionContext,
  TransactionService
>()("@feeblo/TransactionContext") {}

// Resolve the drizzle database to use for the current scope: the in-flight
// transaction client when inside a `transaction` block, otherwise the main
// `Database` service.
export const currentDb: Effect.Effect<
  PgDrizzle.EffectPgDatabase,
  never,
  Database
> = Effect.gen(function* () {
  const maybeTx = yield* Effect.serviceOption(TransactionContext);
  if (Option.isSome(maybeTx)) {
    return maybeTx.value.db;
  }
  return yield* Database;
});

// Run an effect inside a database transaction. The transaction client is
// provided via `TransactionContext` so any `currentDb` usage within `effect`
// (including by repository methods) automatically participates in the tx.
export function transaction<A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError, R | Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    return yield* db.transaction((tx) =>
      effect.pipe(
        Effect.provideService(
          TransactionContext,
          TransactionContext.of({ db: tx })
        )
      )
    );
  });
}
