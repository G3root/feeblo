import { sql } from "drizzle-orm";
import { integer, pgTable } from "drizzle-orm/pg-core";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, it } from "vitest";
import {
  currentDb,
  Database,
  PgliteDatabaseLive,
  transaction,
} from "./database";

const TestDatabaseLive = PgliteDatabaseLive.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ DATABASE_URL: "pglite:memory://" })
    )
  )
);

const transactionTestTable = pgTable("transaction_test", {
  id: integer("id").primaryKey(),
});

it("rolls back captured database queries and nested savepoints", async () => {
  const rows = await Effect.runPromise(
    Effect.gen(function* () {
      // This deliberately captures the root database before either transaction,
      // matching how repository layers are constructed in the domain package.
      const capturedDb = yield* currentDb;
      yield* capturedDb.execute(
        sql`CREATE TABLE transaction_test (id integer PRIMARY KEY)`
      );

      yield* transaction(
        capturedDb
          .insert(transactionTestTable)
          .values({ id: 0 })
          .pipe(Effect.andThen(Effect.fail("rollback")))
      ).pipe(Effect.catch(() => Effect.void));

      yield* transaction(
        Effect.gen(function* () {
          yield* capturedDb.insert(transactionTestTable).values({ id: 1 });
          yield* transaction(
            capturedDb
              .insert(transactionTestTable)
              .values({ id: 2 })
              .pipe(Effect.andThen(Effect.fail("rollback savepoint")))
          ).pipe(Effect.catch(() => Effect.void));
          yield* capturedDb.insert(transactionTestTable).values({ id: 3 });
        })
      );

      // Direct service access remains the stable root database; transaction
      // routing is handled by Effect SQL rather than by leaking a tx client.
      expect(yield* Database).toBe(capturedDb);
      return yield* capturedDb
        .select({ id: transactionTestTable.id })
        .from(transactionTestTable)
        .orderBy(transactionTestTable.id);
    }).pipe(Effect.provide(TestDatabaseLive))
  );

  expect(rows).toEqual([{ id: 1 }, { id: 3 }]);
});
