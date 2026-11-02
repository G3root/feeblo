import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

/**
 * A block row the repository could not read or write consistently.
 *
 * The handler folds it into `InternalServerError`; it exists so the
 * repository does not have to import the RPC error vocabulary.
 */
export class UserBlockDataError extends Schema.TaggedError<UserBlockDataError>()(
  "UserBlockDataError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export const UserBlockServiceErrors = Schema.Union([
  UnauthorizedError,
  PolicyDeniedError,
  NotFoundError,
  BadRequestError,
  InternalServerError,
]);
