import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class FailedToCreateChangelogError extends Schema.TaggedError<FailedToCreateChangelogError>()(
  "FailedToCreateChangelogError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateChangelogError" }
) {}

export class FailedToDeleteChangelogError extends Schema.TaggedError<FailedToDeleteChangelogError>()(
  "FailedToDeleteChangelogError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteChangelogError" }
) {}

export class FailedToUpdateChangelogError extends Schema.TaggedError<FailedToUpdateChangelogError>()(
  "FailedToUpdateChangelogError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateChangelogError" }
) {}

/** No published changelog matched the given slug/organization. */
export class ChangelogNotFoundError extends Schema.TaggedError<ChangelogNotFoundError>()(
  "ChangelogNotFoundError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 404, identifier: "ChangelogNotFoundError" }
) {}

export const ChangelogServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  ChangelogNotFoundError,
  FailedToCreateChangelogError,
  FailedToDeleteChangelogError,
  FailedToUpdateChangelogError,
]);
