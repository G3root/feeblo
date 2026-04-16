/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */

import * as Pg from "@effect/sql-drizzle/Pg";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { DatabaseConfig } from "./config";
import * as relationalSchema from "./relations";
import * as schema from "./schema";

export const PgClientLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { url } = yield* DatabaseConfig;
    return PgClient.layer({ url });
  }).pipe(Effect.provide(DatabaseConfig.layer))
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
