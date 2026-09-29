import * as Effect from "effect/Effect";

import { internalError } from "./errors";

/**
 * The repository's driver failure, answered on the published vocabulary.
 *
 * `withRemapDbErrors` turns a driver failure into the domain's
 * `InternalServerError`; the code a caller switches on is this API's own
 * `INTERNAL_ERROR`, so renaming an internal error cannot change the published
 * body. The message is fixed for the same reason — a driver message can carry
 * a constraint name or a row.
 *
 * It is an `Effect` value rather than a zero-argument factory: the failure is
 * already lazy, and `catchTag` accepts `() => onInternalError` at each call
 * site, so there is no wrapper to keep in sync.
 */
export const onInternalError = Effect.fail(
  internalError("The request could not be completed.")
);
