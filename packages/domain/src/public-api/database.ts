import { Database } from "@feeblo/db";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * Reads the database from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so an operation that runs a transaction takes the handle from
 * the context the composition provides. It is the same accessor shape as
 * `currentPublicApiCaller` and `currentCommentService`, and it keeps `Database`
 * out of a handler's requirement channel where the HTTP layer would turn it
 * into a request-time failure.
 */
export const currentPublicApiDatabase = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, Database.Database))
);
