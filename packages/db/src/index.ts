/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */

import * as Pg from "@effect/sql-drizzle/Pg";
import { PgClient } from "@effect/sql-pg";
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

const makeDb = Pg.make({
  schema: { ...schema, ...relationalSchema },
});

export class DB extends Effect.Service<DB>()("DB", {
  effect: makeDb,
}) {
  static readonly layer = this.Default;
  static readonly Client = this.layer.pipe(Layer.provideMerge(PgClientLive));
}

export const DBLive = DB.layer;
