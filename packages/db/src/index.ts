/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */
import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Redacted } from "effect";
import { types } from "pg";
import { relations } from "./relations";
import * as schema from "./schema";

// Configure the PgClient layer with type parsers
export const PgClientLive = PgClient.layer({
  url: Redacted.make(process.env.DATABASE_URL!),
  types: {
    getTypeParser: (typeId, format) => {
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

const dbEffect = PgDrizzle.make({ relations, schema }).pipe(
  Effect.provide(PgDrizzle.DefaultServices)
);

export class DB extends Context.Tag("DB")<
  DB,
  Effect.Effect.Success<typeof dbEffect>
>() {}
