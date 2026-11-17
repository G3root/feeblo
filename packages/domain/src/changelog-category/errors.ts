import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class ChangelogCategoryNotFoundError extends Schema.TaggedError<ChangelogCategoryNotFoundError>()(
  "ChangelogCategoryNotFoundError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 404, identifier: "ChangelogCategoryNotFoundError" }
) {}

export class FailedToCreateChangelogCategoryError extends Schema.TaggedError<FailedToCreateChangelogCategoryError>()(
  "FailedToCreateChangelogCategoryError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateChangelogCategoryError" }
) {}

export class FailedToUpdateChangelogCategoryError extends Schema.TaggedError<FailedToUpdateChangelogCategoryError>()(
  "FailedToUpdateChangelogCategoryError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateChangelogCategoryError" }
) {}

export class FailedToDeleteChangelogCategoryError extends Schema.TaggedError<FailedToDeleteChangelogCategoryError>()(
  "FailedToDeleteChangelogCategoryError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteChangelogCategoryError" }
) {}

export const ChangelogCategoryServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  ChangelogCategoryNotFoundError,
  FailedToCreateChangelogCategoryError,
  FailedToUpdateChangelogCategoryError,
  FailedToDeleteChangelogCategoryError,
]);
