/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */
import { PgClient } from "@effect/sql-pg";
import * as Pg from "@effect/sql-drizzle/Pg";
import { Config, Effect, Layer } from "effect";
import * as relationalSchema from "./relations";
import * as schema from "./schema";

export const PgClientLive = Layer.unwrapEffect(
  Config.redacted("DATABASE_URL").pipe(
    Effect.map((url) =>
      PgClient.layer({
        url,
      })
    )
  )
);

export class DB extends Effect.Service<DB>()("DB", {
  effect: Pg.make({
    schema: { ...schema, ...relationalSchema },
  }),
}) {
  static Client = this.Default.pipe(Layer.provideMerge(PgClientLive));
}

export const DBLive = DB.Default;
