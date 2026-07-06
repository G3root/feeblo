import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class FailedToCreateChangelogError extends Schema.TaggedErrorClass<FailedToCreateChangelogError>()(
  "FailedToCreateChangelogError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateChangelogError" }
) {}

export class FailedToDeleteChangelogError extends Schema.TaggedErrorClass<FailedToDeleteChangelogError>()(
  "FailedToDeleteChangelogError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteChangelogError" }
) {}

export class FailedToUpdateChangelogError extends Schema.TaggedErrorClass<FailedToUpdateChangelogError>()(
  "FailedToUpdateChangelogError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateChangelogError" }
) {}

export const ChangelogServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  FailedToCreateChangelogError,
  FailedToDeleteChangelogError,
  FailedToUpdateChangelogError,
]);
