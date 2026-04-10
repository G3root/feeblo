import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class FailedToCreateChangelogError extends Schema.TaggedError<FailedToCreateChangelogError>()(
  "FailedToCreateChangelogError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToCreateChangelogError",
  })
) {}

export class FailedToDeleteChangelogError extends Schema.TaggedError<FailedToDeleteChangelogError>()(
  "FailedToDeleteChangelogError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToDeleteChangelogError",
  })
) {}

export class FailedToUpdateChangelogError extends Schema.TaggedError<FailedToUpdateChangelogError>()(
  "FailedToUpdateChangelogError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToUpdateChangelogError",
  })
) {}

export const ChangelogServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  FailedToCreateChangelogError,
  FailedToDeleteChangelogError,
  FailedToUpdateChangelogError
);
