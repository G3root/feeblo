import * as SQLPG from "@effect/sql-pg";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
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

export const PgClientFactory = {
  create: (url: Config.Config<Redacted.Redacted<string>>) =>
    SQLPG.PgClient.layerConfig({
      url,
      types: Config.succeed(pgTypes),
    }),
};

// Configure the PgClient layer
export const PgClientLive = PgClientFactory.create(
  Config.redacted("DATABASE_URL")
);

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

// Create the DB effect with default services
const dbEffect = PgDrizzle.make({ relations }).pipe(
  Effect.provide(PgDrizzle.DefaultServices),
  Effect.tap(testConnection)
);

// Define a DB service tag for dependency injection
export class Database extends Context.Service<
  Database,
  PgDrizzle.EffectPgDatabase
>()("@feeblo/Database") {}

// Create a layer that provides the DB service
export const DatabaseLive = Layer.effect(Database, dbEffect);

export const DatabaseContextLive = DatabaseLive.pipe(
  Layer.provide(PgClientLive)
);

// Tracks the active transaction client so repository methods automatically
// run on the current transaction when one is in progress.
export interface TransactionService {
  readonly db: PgDrizzle.EffectPgDatabase;
}

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
