/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */

import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Layer, Redacted } from "effect";
import { types } from "pg";
import { relations } from "./relations";

const PgClientLive = PgClient.layer({
  url: Redacted.make(process.env.DATABASE_URL!),
  types: {
    getTypeParser: (typeId, format) => {
      // Return raw values for date/time types to let Drizzle handle parsing
      if (
        [1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182].includes(typeId)
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        return (val: any) => val;
      }
      return types.getTypeParser(typeId, format);
    },
  },
});

const makeDb = PgDrizzle.makeWithDefaults({
  relations,
});

export class DB extends Context.Service<DB>()("DB", {
  make: makeDb,
}) {
  static readonly layer = Layer.effect(this, this.make);
  static readonly Client = this.layer.pipe(Layer.provideMerge(PgClientLive));
}

export const DBLive = DB.layer;
